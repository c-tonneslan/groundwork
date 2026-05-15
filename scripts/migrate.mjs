// Apply db/schema.sql to the configured database. Idempotent.
//
//   node scripts/migrate.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase")
    ? { rejectUnauthorized: false }
    : false,
});

async function main() {
  const sql = readFileSync(path.resolve(process.cwd(), "db/schema.sql"), "utf8");
  console.log("applying db/schema.sql...");
  await pool.query(sql);
  console.log("done.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
