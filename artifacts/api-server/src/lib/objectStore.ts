import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  const parts = normalised.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid object path: must contain a bucket name");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function privateDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Object storage must be provisioned before uploading files.",
    );
  }
  return dir;
}

function fileFor(key: string) {
  let dir = privateDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const { bucketName, objectName } = parseObjectPath(`${dir}${key}`);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

/** Generate a fresh, collision-free object key with the given extension. */
export function newObjectKey(extension: string): string {
  return `${randomUUID()}.${extension}`;
}

export async function uploadObject(
  key: string,
  buffer: Buffer,
  contentType?: string,
): Promise<void> {
  await fileFor(key).save(buffer, {
    contentType: contentType ?? "application/octet-stream",
  });
}

export async function downloadObject(key: string): Promise<Buffer> {
  const [buffer] = await fileFor(key).download();
  return buffer;
}

export async function objectExists(key: string): Promise<boolean> {
  const [exists] = await fileFor(key).exists();
  return exists;
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await fileFor(key).delete();
  } catch (err) {
    logger.warn({ err, key }, "Failed to delete object (best-effort)");
  }
}
