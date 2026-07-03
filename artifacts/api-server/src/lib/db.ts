import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "./paths";
import { logger } from "./logger";

fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    resume_filename TEXT,
    resume_json TEXT,
    style_map_json TEXT,
    extra_answers_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT,
    source_url TEXT,
    posting_text TEXT,
    status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Tailoring', 'Ready', 'Applied')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('resume', 'cover_letter', 'cover_letter_plain', 'cover_note')),
    content_json TEXT,
    docx_path TEXT,
    pdf_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS qa_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

logger.info({ dbPath }, "SQLite database ready");

export interface ProfileRow {
  id: number;
  resume_filename: string | null;
  resume_json: string | null;
  style_map_json: string | null;
  extra_answers_json: string | null;
  updated_at: string;
}

export interface JobRow {
  id: number;
  title: string;
  company: string | null;
  source_url: string | null;
  posting_text: string | null;
  status: "New" | "Tailoring" | "Ready" | "Applied";
  created_at: string;
}

export interface DocumentRow {
  id: number;
  job_id: number;
  type: "resume" | "cover_letter" | "cover_letter_plain" | "cover_note";
  content_json: string | null;
  docx_path: string | null;
  pdf_path: string | null;
  created_at: string;
}

export interface QaLogRow {
  id: number;
  job_id: number;
  question: string;
  answer: string | null;
  created_at: string;
}
