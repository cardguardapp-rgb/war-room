import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import multer from "multer";
import { db, type ProfileRow } from "../lib/db";
import { uploadsDir } from "../lib/paths";

const router: IRouter = Router();

fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".docx";
      cb(null, `resume-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
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

router.get("/profile", (_req, res): void => {
  const profile = getProfile();
  res.json(profile ?? null);
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

  res.json(getProfile());
});

router.post(
  "/profile/resume",
  upload.single("resume"),
  (req, res): void => {
    if (!req.file) {
      res.status(400).json({ error: "No resume file uploaded" });
      return;
    }

    ensureProfileRow();

    db.prepare(
      `UPDATE profile
       SET resume_filename = ?, updated_at = datetime('now')
       WHERE id = 1`,
    ).run(req.file.filename);

    req.log.info({ filename: req.file.filename }, "Resume uploaded");
    res.status(201).json(getProfile());
  },
);

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
