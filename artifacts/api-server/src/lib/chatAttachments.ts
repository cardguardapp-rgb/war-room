// Chat attachments: ingest uploaded files for the role-advice chat and turn a
// saved turn back into Anthropic content blocks.
//
// - Images (png/jpeg/gif/webp) and PDFs are kept as BINARY in object storage and
//   re-sent to the model as image/document blocks on every turn, so the model
//   still "sees" them when the candidate asks a follow-up.
// - Text-like files (.txt/.md/.csv) and .docx are extracted to plain text at
//   upload and inlined into the prompt — cheaper, and they persist trivially.

import JSZip from "jszip";
import { downloadObject, newObjectKey, uploadObject } from "./objectStore";
import type { ChatAttachment, ChatTurn } from "./chatStore";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv"];
const PDF_TYPE = "application/pdf";
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  [PDF_TYPE]: "pdf",
};

/** Some browsers send .md/.csv as octet-stream — fall back to the extension. */
function effectiveType(mimetype: string, filename: string): string {
  if (mimetype && mimetype !== "application/octet-stream") return mimetype;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return PDF_TYPE;
  if (lower.endsWith(".docx")) return DOCX_TYPE;
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  return mimetype;
}

export function isAcceptedAttachment(mimetype: string, filename: string): boolean {
  const t = effectiveType(mimetype, filename);
  return (
    IMAGE_TYPES.includes(t) || TEXT_TYPES.includes(t) || t === PDF_TYPE || t === DOCX_TYPE
  );
}

/**
 * Pull the plain text out of a .docx. The API can't read .docx natively, and we
 * only need the words here (not the run/style detail resumeParser captures), so
 * unzip document.xml and strip the markup, preserving paragraph breaks.
 */
async function docxToText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Store/extract one uploaded file and return its persisted descriptor. */
export async function ingestAttachment(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<ChatAttachment> {
  const name = file.originalname || "attachment";
  const type = effectiveType(file.mimetype, name);

  if (IMAGE_TYPES.includes(type) || type === PDF_TYPE) {
    const key = newObjectKey(EXT_FOR_TYPE[type] ?? "bin");
    await uploadObject(key, file.buffer, type);
    return {
      name,
      kind: type === PDF_TYPE ? "document" : "image",
      mediaType: type,
      objectKey: key,
    };
  }

  const text =
    type === DOCX_TYPE
      ? await docxToText(file.buffer)
      : file.buffer.toString("utf8");
  return { name, kind: "text", mediaType: type, text: text.slice(0, 60000) };
}

/**
 * Turn a saved turn into the Anthropic message content: a plain string when it
 * has no attachments, otherwise a content-block array (binary re-fetched from
 * object storage). An attachment that can't be re-read is skipped, not fatal.
 */
export async function buildTurnContent(turn: ChatTurn): Promise<string | unknown[]> {
  const attachments = turn.attachments ?? [];
  if (attachments.length === 0) return turn.content;

  const blocks: unknown[] = [];
  for (const att of attachments) {
    if (att.kind === "text") {
      if (att.text) {
        blocks.push({
          type: "text",
          text: `[Attached file: ${att.name}]\n${att.text}`,
        });
      }
      continue;
    }
    if (!att.objectKey) continue;
    let data: string;
    try {
      data = (await downloadObject(att.objectKey)).toString("base64");
    } catch {
      continue; // object gone — carry on without it rather than failing the chat
    }
    blocks.push({
      type: att.kind === "document" ? "document" : "image",
      source: { type: "base64", media_type: att.mediaType, data },
    });
  }

  blocks.push({
    type: "text",
    text:
      turn.content ||
      "Please review the attached file(s) and tell me what matters for this role.",
  });
  return blocks;
}
