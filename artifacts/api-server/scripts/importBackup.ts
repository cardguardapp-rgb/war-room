// Loads a War Room backup zip (from Profile → "Download all my data") into the
// local warroom-dev database and the local storage folder. Local use only.
//
// Run from the repo root:
//   pnpm --filter @workspace/api-server run import-backup "<path to zip>" [--replace]
//
// --replace empties the warroom-dev tables first (needed when they already hold data).
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { getTableColumns, type Table } from "drizzle-orm";
import { assertLocalDatabase, isLocalDev } from "@workspace/db/env";
import {
  pool,
  profileTable,
  jobsTable,
  documentsTable,
  qaLogTable,
  discoverSettingsTable,
  discoverDismissedTable,
} from "@workspace/db";
import { localObjectPath, localStorageRoot } from "../src/lib/objectStore";

// Insert order respects the foreign keys (documents/qa_log → jobs).
const TABLES: { key: string; name: string; table: Table; identity: boolean }[] = [
  { key: "profile", name: "profile", table: profileTable, identity: false },
  { key: "jobs", name: "jobs", table: jobsTable, identity: true },
  { key: "documents", name: "documents", table: documentsTable, identity: true },
  { key: "qa_log", name: "qa_log", table: qaLogTable, identity: true },
  { key: "discover_settings", name: "discover_settings", table: discoverSettingsTable, identity: false },
  { key: "discover_dismissed", name: "discover_dismissed", table: discoverDismissedTable, identity: false },
];

function fail(message: string): never {
  console.error(`\nImport stopped: ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const zipArg = args.find((a) => !a.startsWith("--"));
  if (!zipArg) fail("give the path to the backup zip.");
  const zipPath = path.resolve(zipArg);

  // --- Guard: warroom-dev only -------------------------------------------
  if (!isLocalDev()) fail("this script only runs locally in development, never on Replit.");
  const url = process.env["DATABASE_URL"];
  if (!url) fail("DATABASE_URL is not set in .env.");
  // @workspace/db already ran this on import; repeated so the guard is explicit here.
  try {
    assertLocalDatabase(url);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  // --- Read the zip --------------------------------------------------------
  let zipBuffer: Buffer;
  try {
    zipBuffer = await fs.readFile(zipPath);
  } catch {
    fail(`can't read ${zipPath}.`);
  }
  const zip = await JSZip.loadAsync(zipBuffer);
  const dataFile = zip.file("data.json");
  if (!dataFile) fail("the zip has no data.json — is it a War Room backup?");
  const data = JSON.parse(await dataFile.async("string")) as Record<string, unknown>;
  for (const t of TABLES) {
    if (!Array.isArray(data[t.key])) fail(`data.json has no "${t.key}" list.`);
  }

  // --- Check the tables exist and whether they hold data -------------------
  for (const t of TABLES) {
    const { rows } = await pool.query<{ reg: string | null }>("select to_regclass($1) as reg", [
      `public.${t.name}`,
    ]);
    if (!rows[0]?.reg) {
      fail(
        `table "${t.name}" doesn't exist in warroom-dev. Create the tables first with: pnpm --filter @workspace/db push`,
      );
    }
  }
  const { rows: countRows } = await pool.query<{ n: string }>(
    `select (select count(*) from profile) + (select count(*) from jobs) +
            (select count(*) from documents) + (select count(*) from qa_log) +
            (select count(*) from discover_settings) + (select count(*) from discover_dismissed) as n`,
  );
  const existing = Number(countRows[0]?.n ?? 0);
  if (existing > 0 && !replace) {
    fail(`warroom-dev already holds ${existing} rows. Run again with --replace to empty it first.`);
  }

  // --- Load rows (ids preserved) -------------------------------------------
  const client = await pool.connect();
  const counts: Record<string, number> = {};
  try {
    await client.query("begin");
    if (replace) {
      await client.query(
        `truncate ${TABLES.map((t) => t.name).join(", ")} restart identity cascade`,
      );
    }
    for (const t of TABLES) {
      const columns = Object.entries(getTableColumns(t.table));
      const rows = data[t.key] as Record<string, unknown>[];
      for (const row of rows) {
        const present = columns.filter(([jsKey]) => jsKey in row);
        const names = present.map(([, col]) => `"${col.name}"`).join(", ");
        const params = present.map((_, i) => `$${i + 1}`).join(", ");
        const values = present.map(([jsKey, col]) => {
          const v = row[jsKey];
          // jsonb: send as JSON text (pg would turn a JS array into a Postgres array).
          return col.dataType === "json" && v !== null && v !== undefined ? JSON.stringify(v) : v;
        });
        await client.query(
          `insert into ${t.name} (${names}) ${t.identity ? "overriding system value " : ""}values (${params})`,
          values,
        );
      }
      counts[t.name] = rows.length;
    }
    // Continue the id sequences after the imported ids.
    for (const t of TABLES.filter((t) => t.identity)) {
      await client.query(
        `select setval(pg_get_serial_sequence('${t.name}', 'id'),
                       coalesce((select max(id) from ${t.name}), 1),
                       (select max(id) from ${t.name}) is not null)`,
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  // --- Stored files → local storage folder, original keys -------------------
  let files = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith("files/")) continue;
    const key = entry.name.slice("files/".length);
    if (!key) continue;
    const target = localObjectPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async("nodebuffer"));
    files++;
  }

  console.log("\nImported into warroom-dev:");
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(20)} ${n}`);
  console.log(`  ${"files".padEnd(20)} ${files} → ${localStorageRoot()}`);
  console.log("");
}

main()
  .catch((err) => {
    console.error("\nImport failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
