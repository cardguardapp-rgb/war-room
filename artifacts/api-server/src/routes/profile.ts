import JSZip from "jszip";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { db, eq, ensureProfileRow, profileTable, jobsTable, documentsTable, qaLogTable, discoverSettingsTable, discoverDismissedTable, type Profile } from "../lib/db";
import { uploadObject, downloadObject, objectExists, deleteObject, newObjectKey } from "../lib/objectStore";
import { parseResumeDocx } from "../lib/resumeParser";

const router: IRouter = Router();

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_BYTES },
  fileFilter: (_req, file, cb) => {
    const isDocx =
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.toLowerCase().endsWith(".docx");
    if (!isDocx) {
      cb(new Error("Only .docx files are accepted"));
      return;
    }
    cb(null, true);
  },
});

/** Run multer but turn its errors (size limit, wrong type) into clean 400s. */
function uploadResume(req: Request, res: Response, next: NextFunction): void {
  upload.single("resume")(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Resume exceeds the 5MB limit"
          : err instanceof Error
            ? err.message
            : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

function serializeProfile(row: Profile | undefined | null) {
  if (!row) return null;
  return {
    ...row,
    resume_json: row.resumeJson ?? null,
    style_map_json: row.styleMapJson ?? null,
    extra_answers_json: row.extraAnswersJson ?? null,
    extra_context: row.extraContext ?? null,
    resume_filename: row.resumeFilename ?? null,
    updated_at: row.updatedAt,
  };
}

async function getProfile(): Promise<Profile | undefined> {
  const [row] = await db.select().from(profileTable).where(eq(profileTable.id, 1));
  return row;
}

router.get("/profile", async (_req, res): Promise<void> => {
  res.json(serializeProfile(await getProfile()));
});

router.patch("/profile", async (req, res): Promise<void> => {
  const { resume_json, style_map_json, extra_answers_json, extra_context } =
    req.body ?? {};

  if (extra_context !== undefined && typeof extra_context !== "string" && extra_context !== null) {
    res.status(400).json({ error: "extra_context must be a string" });
    return;
  }

  await ensureProfileRow();

  const updates: Partial<typeof profileTable.$inferInsert> = { updatedAt: new Date() };
  if (resume_json != null) updates.resumeJson = resume_json;
  if (style_map_json != null) updates.styleMapJson = style_map_json;
  if (extra_answers_json != null) updates.extraAnswersJson = extra_answers_json;
  if (extra_context !== undefined) updates.extraContext = extra_context;

  await db.update(profileTable).set(updates).where(eq(profileTable.id, 1));

  res.json(serializeProfile(await getProfile()));
});

/**
 * Upload + parse a resume WITHOUT committing it. Returns the parsed structure
 * for the user to review. The original .docx is stashed in object storage
 * (referenced by the returned `filename`, an object key) so a later
 * PUT /profile/resume can confirm it. The existing profile is left untouched
 * until the user confirms.
 */
router.post(
  "/profile/resume/parse",
  uploadResume,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No resume file uploaded" });
      return;
    }

    const filename = newObjectKey("docx");

    try {
      const buffer = req.file.buffer;
      const { resumeJson, styleMap, warnings } = await parseResumeDocx(buffer);
      await uploadObject(
        filename,
        buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      req.log.info(
        { filename, warnings: warnings.length },
        "Resume parsed for review",
      );
      res.json({
        filename,
        resume_json: resumeJson,
        style_map_json: styleMap,
        warnings,
      });
    } catch (err) {
      req.log.error({ err, filename }, "Resume parse failed");
      res.status(422).json({
        error:
          err instanceof Error
            ? `Could not parse this .docx: ${err.message}`
            : "Could not parse this .docx",
      });
    }
  },
);

/**
 * Confirm a reviewed resume. Persists the (possibly user-corrected) structured
 * data + style map and marks `filename` (an object storage key) as the base
 * resume. The previous base resume file is removed — the parsed structure is
 * now the single source of truth; the .docx is kept only as a formatting
 * reference.
 */
router.put("/profile/resume", async (req, res): Promise<void> => {
  const { filename, resume_json, style_map_json } = req.body ?? {};

  if (typeof filename !== "string") {
    res.status(400).json({ error: "filename is required" });
    return;
  }
  if (!(await objectExists(filename))) {
    res.status(404).json({
      error: "That uploaded resume is no longer available. Please re-upload.",
    });
    return;
  }
  if (resume_json == null) {
    res.status(400).json({ error: "resume_json is required" });
    return;
  }

  await ensureProfileRow();

  const previous = await getProfile();

  await db
    .update(profileTable)
    .set({
      resumeFilename: filename,
      resumeJson: resume_json,
      styleMapJson: style_map_json != null ? style_map_json : undefined,
      updatedAt: new Date(),
    })
    .where(eq(profileTable.id, 1));

  if (previous?.resumeFilename && previous.resumeFilename !== filename) {
    await deleteObject(previous.resumeFilename);
  }

  req.log.info({ filename }, "Resume confirmed and saved");
  res.json(serializeProfile(await getProfile()));
});

/**
 * Full data export: everything the app holds, as a single .zip the user can
 * keep as a backup. Contains a human-readable `data.json` dump of every
 * table plus every stored file (resume + generated documents).
 */
router.get("/profile/export", async (req, res): Promise<void> => {
  try {
    const zip = new JSZip();

    const [profile, jobs, documents, qaLog, discoverSettings, discoverDismissed] =
      await Promise.all([
        db.select().from(profileTable),
        db.select().from(jobsTable),
        db.select().from(documentsTable),
        db.select().from(qaLogTable),
        db.select().from(discoverSettingsTable),
        db.select().from(discoverDismissedTable),
      ]);

    const dump = {
      exported_at: new Date().toISOString(),
      profile,
      jobs,
      documents,
      qa_log: qaLog,
      discover_settings: discoverSettings,
      discover_dismissed: discoverDismissed,
    };
    zip.file("data.json", JSON.stringify(dump, null, 2));

    const objectKeys = new Set<string>();
    for (const p of profile) if (p.resumeFilename) objectKeys.add(p.resumeFilename);
    for (const d of documents) {
      if (d.docxObjectKey) objectKeys.add(d.docxObjectKey);
      if (d.pdfObjectKey) objectKeys.add(d.pdfObjectKey);
    }
    for (const key of objectKeys) {
      try {
        if (await objectExists(key)) {
          zip.file(`files/${key}`, await downloadObject(key));
        }
      } catch {
        // skip unreadable file
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="war-room-backup-${date}.zip"`,
    );
    res.send(buffer);
    req.log.info({ files: objectKeys.size }, "Data export generated");
  } catch (err) {
    req.log.error({ err }, "Data export failed");
    res.status(500).json({ error: "Could not build the export. Please try again." });
  }
});

router.get("/profile/resume", async (_req, res): Promise<void> => {
  const profile = await getProfile();
  if (!profile?.resumeFilename) {
    res.status(404).json({ error: "No resume uploaded yet" });
    return;
  }

  try {
    const buffer = await downloadObject(profile.resumeFilename);
    res.setHeader("Content-Disposition", `attachment; filename="${profile.resumeFilename}"`);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Resume file not found" });
  }
});

export default router;
