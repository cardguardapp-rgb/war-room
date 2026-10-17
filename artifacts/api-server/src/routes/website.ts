import { Router, type IRouter } from "express";
import JSZip from "jszip";
import { db, eq, profileTable } from "../lib/db";
import { uploadObject, downloadObject, objectExists } from "../lib/objectStore";
import { aiErrorResponse, createJson, chatComplete } from "../lib/anthropic";
import { WEBSITE_DRAFT_SYSTEM, WEBSITE_FIELD_SYSTEM } from "../lib/prompts";
import { aiModel } from "../lib/models";
import {
  buildSite,
  buildPreviewPage,
  normaliseWebsiteConfig,
  type WebsiteConfig,
} from "../lib/siteBuild";
import type { ResumeJson } from "../lib/resumeParser";

const router: IRouter = Router();

const CONFIG_KEY = "website/config.json";

async function loadResume(): Promise<ResumeJson | null> {
  const [profile] = await db.select().from(profileTable).where(eq(profileTable.id, 1));
  const r = (profile?.resumeJson ?? null) as ResumeJson | null;
  return r && Array.isArray(r.sections) ? r : null;
}

async function loadConfigRaw(): Promise<unknown> {
  try {
    if (await objectExists(CONFIG_KEY)) {
      return JSON.parse((await downloadObject(CONFIG_KEY)).toString("utf8"));
    }
  } catch {
    // corrupt/missing — fall back to defaults
  }
  return null;
}

async function currentConfig(resume: ResumeJson | null): Promise<WebsiteConfig> {
  return normaliseWebsiteConfig(await loadConfigRaw(), resume);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "personal"
  );
}

// --- config -------------------------------------------------------------

router.get("/website", async (_req, res): Promise<void> => {
  const resume = await loadResume();
  res.json({ config: await currentConfig(resume), has_resume: !!resume });
});

router.put("/website", async (req, res): Promise<void> => {
  const resume = await loadResume();
  const config = normaliseWebsiteConfig((req.body ?? {}).config ?? req.body, resume);
  await uploadObject(CONFIG_KEY, Buffer.from(JSON.stringify(config), "utf8"), "application/json");
  res.json({ config });
});

// --- AI draft of headline/tagline/bio/about -----------------------------

router.post("/website/draft", async (req, res): Promise<void> => {
  const resume = await loadResume();
  if (!resume) {
    res.status(400).json({ error: "Add and confirm your resume on the Profile page first." });
    return;
  }
  try {
    const draft = await createJson<{
      headline?: string;
      tagline?: string;
      bio?: string;
      about?: string;
    }>({
      model: aiModel("website"),
      maxTokens: 1500,
      system: WEBSITE_DRAFT_SYSTEM,
      user: `CANDIDATE RESUME (JSON):\n${JSON.stringify(resume)}`,
    });
    res.json({
      headline: (draft.headline ?? "").trim(),
      tagline: (draft.tagline ?? "").trim(),
      bio: (draft.bio ?? "").trim(),
      about: (draft.about ?? "").trim(),
    });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err }, "Website copy draft failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// --- per-field AI writing help ------------------------------------------

const FIELD_SPECS: Record<string, { label: string; brief: string; max: number }> = {
  headline: {
    label: "headline",
    brief: "A few words capturing their role or positioning (e.g. 'Head of Product'). Not a sentence — just the headline.",
    max: 160,
  },
  tagline: {
    label: "tagline",
    brief: "ONE short, punchy line that sits under the headline — human and specific to them.",
    max: 240,
  },
  bio: {
    label: "home-page bio",
    brief: "2–4 warm, confident sentences about who they are and what they do.",
    max: 2000,
  },
  about: {
    label: "About page",
    brief: "1–3 short paragraphs telling their professional story. Separate paragraphs with a blank line.",
    max: 8000,
  },
};

router.post("/website/write", async (req, res): Promise<void> => {
  const resume = await loadResume();
  if (!resume) {
    res.status(400).json({ error: "Add and confirm your resume on the Profile page first." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const spec = FIELD_SPECS[String(body["field"])];
  if (!spec) {
    res.status(400).json({ error: "Unknown website field." });
    return;
  }
  const current = typeof body["current"] === "string" ? body["current"].trim().slice(0, 8000) : "";
  const instruction =
    typeof body["instruction"] === "string" ? body["instruction"].trim().slice(0, 500) : "";
  try {
    const system = `${WEBSITE_FIELD_SYSTEM}\n\nSECTION: ${spec.label}\nBRIEF: ${spec.brief}\n\nCANDIDATE RESUME (JSON):\n${JSON.stringify(resume)}`;
    const user = [
      current
        ? `CURRENT ${spec.label} (improve or replace it):\n${current}`
        : `There is no ${spec.label} yet — write one.`,
      instruction ? `THE CANDIDATE ASKS: ${instruction}` : "",
      `Return ONLY the finished ${spec.label} text.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const text = await chatComplete({
      model: aiModel("website"),
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 1200,
    });
    res.json({ text: text.trim().slice(0, spec.max) });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, field: body["field"] }, "Website field write failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// --- preview (serves generated HTML for an <iframe>/new tab) -------------

router.get("/website/preview", async (req, res): Promise<void> => {
  const resume = await loadResume();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!resume) {
    res.send(
      "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:40px;color:#555'>Add and confirm your resume on the Profile page first, then save your website details to preview.</body>",
    );
    return;
  }
  const config = await currentConfig(resume);
  const page = typeof req.query.page === "string" ? req.query.page : "index";
  res.send(buildPreviewPage(resume, config, page));
});

// --- download the static site as a .zip ---------------------------------

router.get("/website/export", async (req, res): Promise<void> => {
  const resume = await loadResume();
  if (!resume) {
    res.status(400).json({ error: "Add and confirm your resume on the Profile page first." });
    return;
  }
  const config = await currentConfig(resume);
  const files = buildSite(resume, config, "files");
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${slugify(config.name)}-website.zip"`,
  );
  res.send(buffer);
});

export default router;
