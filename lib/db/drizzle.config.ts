import { defineConfig } from "drizzle-kit";
import path from "path";
import { assertLocalDatabase } from "./src/env";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

assertLocalDatabase(process.env.DATABASE_URL);

export default defineConfig({
  // drizzle-kit treats this as a glob, where backslashes are escapes, so use
  // forward slashes on Windows too. Absolute, so it doesn't depend on the cwd.
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
