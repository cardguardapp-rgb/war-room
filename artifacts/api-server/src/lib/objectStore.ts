import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { findRepoRoot, isReplit } from "@workspace/db/env";
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

// Driver: Replit Object Storage when the Replit sidecar is there (always the
// case on Replit); otherwise a local folder, for development on the laptop.
type Driver = "replit" | "local";
let driverPromise: Promise<Driver> | undefined;

function sidecarReachable(): Promise<boolean> {
  const { hostname, port } = new URL(REPLIT_SIDECAR_ENDPOINT);
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port: Number(port) });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(750, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function driver(): Promise<Driver> {
  driverPromise ??= (async (): Promise<Driver> => {
    if (isReplit() || (await sidecarReachable())) return "replit";
    logger.info({ dir: localStorageRoot() }, "Object storage: local folder");
    return "local";
  })();
  return driverPromise;
}

/** Folder used by the local driver: `<repo root>/.local-storage` (gitignored). */
export function localStorageRoot(): string {
  return path.join(findRepoRoot() ?? process.cwd(), ".local-storage");
}

/** Absolute local path for an object key; rejects keys that would escape the folder. */
export function localObjectPath(key: string): string {
  const root = localStorageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return full;
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
  if ((await driver()) === "local") {
    const file = localObjectPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return;
  }
  await fileFor(key).save(buffer, {
    contentType: contentType ?? "application/octet-stream",
  });
}

export async function downloadObject(key: string): Promise<Buffer> {
  if ((await driver()) === "local") return fs.readFile(localObjectPath(key));
  const [buffer] = await fileFor(key).download();
  return buffer;
}

export async function objectExists(key: string): Promise<boolean> {
  if ((await driver()) === "local") {
    try {
      return (await fs.stat(localObjectPath(key))).isFile();
    } catch {
      return false;
    }
  }
  const [exists] = await fileFor(key).exists();
  return exists;
}

export async function deleteObject(key: string): Promise<void> {
  try {
    if ((await driver()) === "local") {
      await fs.rm(localObjectPath(key), { force: true });
      return;
    }
    await fileFor(key).delete();
  } catch (err) {
    logger.warn({ err, key }, "Failed to delete object (best-effort)");
  }
}
