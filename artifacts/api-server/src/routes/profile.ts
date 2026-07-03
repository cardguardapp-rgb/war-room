import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { db, type ProfileRow } from "../lib/db";
import { uploadsDir, dataDir } from "../lib/paths";
import { parseResumeDocx } from "../lib/resumeParser";

const router: IRouter = Router();

fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB
const RESUME_FILENAME_RE = /^resume-\d+\.docx$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, _file, cb) => {
      cb(null, `resume-${Date.now()}.docx`);
    },
  }),
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

/** Parse the JSON text columns so the client receives real objects. */
function serializeProfile(row: ProfileRow | undefined | null) {
  if (!row) return null;
  const parse = (value: string | null) => {
    if (value == null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  return {
    ...row,
    resume_json: parse(row.resume_json),
    style_map_json: parse(row.style_map_json),
    extra_answers_json: parse(row.extra_answers_json),
  };
}

function getProfile(): ProfileRow | undefined {
  return db
    .prepare("SELECT * FROM profile WHERE id = 1")
    .get() as ProfileRow | undefined;
}

function ensureProfileRow(): void {
  db.prepare(
    "INSERT OR IGNORE INTO profile (id, updated_at) VALUES (1, datetime('now'))",
  ).run();
}

/** Resolve a client-supplied resume filename to a safe path inside uploads. */
function resolveResumePath(filename: string): string | null {
  if (!RESUME_FILENAME_RE.test(filename)) return null;
  const resolved = path.resolve(uploadsDir, filename);
  if (path.dirname(resolved) !== path.resolve(uploadsDir)) return null;
  return resolved;
}

/** Remove any resume-*.docx uploads except the ones we want to keep. */
function cleanupResumeFiles(keep: string[]): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(uploadsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!RESUME_FILENAME_RE.test(entry) || keep.includes(entry)) continue;
    try {
      fs.rmSync(path.join(uploadsDir, entry), { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

router.get("/profile", (_req, res): void => {
  res.json(serializeProfile(getProfile()));
});

router.patch("/profile", (req, res): void => {
  const { resume_json, style_map_json, extra_answers_json } = req.body ?? {};

  ensureProfileRow();

  db.prepare(
    `UPDATE profile
     SET resume_json = COALESCE(?, resume_json),
         style_map_json = COALESCE(?, style_map_json),
         extra_answers_json = COALESCE(?, extra_answers_json),
         updated_at = datetime('now')
     WHERE id = 1`,
  ).run(
    resume_json != null ? JSON.stringify(resume_json) : null,
    style_map_json != null ? JSON.stringify(style_map_json) : null,
    extra_answers_json != null ? JSON.stringify(extra_answers_json) : null,
  );

  res.json(serializeProfile(getProfile()));
});

/**
 * Upload + parse a resume WITHOUT committing it. Returns the parsed structure
 * for the user to review. The original .docx is kept on disk (referenced by the
 * returned `filename`) so a later PUT /profile/resume can confirm it. The
 * existing profile is left untouched until the user confirms.
 */
router.post(
  "/profile/resume/parse",
  uploadResume,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No resume file uploaded" });
      return;
    }

    const filename = req.file.filename;
    const committed = getProfile()?.resume_filename ?? "";
    // Keep only the committed resume + this new upload; drop stale orphans.
    cleanupResumeFiles([committed, filename]);

    try {
      const buffer = fs.readFileSync(req.file.path);
      const { resumeJson, styleMap, warnings } =
        await parseResumeDocx(buffer);
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
      // Failed to parse -> discard the upload so it doesn't linger.
      try {
        fs.rmSync(req.file.path, { force: true });
      } catch {
        // ignore
      }
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
 * data + style map and marks `filename` as the base resume on disk. The
 * previous base resume file is removed — the parsed structure is now the single
 * source of truth; the .docx is kept only as a formatting reference.
 */
router.put("/profile/resume", (req, res): void => {
  const { filename, resume_json, style_map_json } = req.body ?? {};

  if (typeof filename !== "string") {
    res.status(400).json({ error: "filename is required" });
    return;
  }
  const resolved = resolveResumePath(filename);
  if (!resolved) {
    res.status(400).json({ error: "Invalid resume filename" });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({
      error: "That uploaded resume is no longer available. Please re-upload.",
    });
    return;
  }
  if (resume_json == null) {
    res.status(400).json({ error: "resume_json is required" });
    return;
  }

  ensureProfileRow();

  db.prepare(
    `UPDATE profile
     SET resume_filename = ?,
         resume_json = ?,
         style_map_json = COALESCE(?, style_map_json),
         updated_at = datetime('now')
     WHERE id = 1`,
  ).run(
    filename,
    JSON.stringify(resume_json),
    style_map_json != null ? JSON.stringify(style_map_json) : null,
  );

  // The confirmed file is now the only base resume we keep.
  cleanupResumeFiles([filename]);

  req.log.info({ filename }, "Resume confirmed and saved");
  res.json(serializeProfile(getProfile()));
});

/**
 * Full data export: everything the app holds, as a single .zip the user can
 * keep as a backup. Contains a consistent SQLite snapshot (`app.db`), a
 * human-readable `data.json` dump of every table, and every file under
 * `uploads/` (the original resume + all generated .docx/.pdf documents).
 */
router.get("/profile/export", async (req, res): Promise<void> => {
  const tmpDb = path.join(dataDir, `export-${Date.now()}.db`);
  try {
    const zip = new JSZip();

    // 1. Consistent SQLite snapshot (handles WAL correctly).
    await db.backup(tmpDb);
    zip.file("app.db", fs.readFileSync(tmpDb));

    // 2. Human-readable dump of every table.
    const dump: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const table of [
      "profile",
      "jobs",
      "documents",
      "qa_log",
      "discover_settings",
      "discover_dismissed",
    ]) {
      try {
        dump[table] = db.prepare(`SELECT * FROM ${table}`).all();
      } catch {
        dump[table] = [];
      }
    }
    zip.file("data.json", JSON.stringify(dump, null, 2));

    // 3. Every uploaded/generated file.
    let files: string[] = [];
    try {
      files = fs.readdirSync(uploadsDir);
    } catch {
      files = [];
    }
    for (const name of files) {
      const full = path.join(uploadsDir, name);
      try {
        if (fs.statSync(full).isFile()) {
          zip.file(`uploads/${name}`, fs.readFileSync(full));
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
    req.log.info({ files: files.length }, "Data export generated");
  } catch (err) {
    req.log.error({ err }, "Data export failed");
    res.status(500).json({ error: "Could not build the export. Please try again." });
  } finally {
    try {
      fs.rmSync(tmpDb, { force: true });
    } catch {
      // ignore
    }
  }
});

router.get("/profile/resume", (_req, res): void => {
  const profile = getProfile();
  if (!profile?.resume_filename) {
    res.status(404).json({ error: "No resume uploaded yet" });
    return;
  }

  const filePath = path.join(uploadsDir, profile.resume_filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Resume file not found on disk" });
    return;
  }

  res.download(filePath, profile.resume_filename);
});

export default router;
