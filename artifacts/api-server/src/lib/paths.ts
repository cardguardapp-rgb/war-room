import path from "node:path";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export const uploadsDir = path.resolve(
  workspaceRoot,
  "artifacts/api-server/uploads",
);
export const dataDir = path.resolve(workspaceRoot, "artifacts/api-server/data");
