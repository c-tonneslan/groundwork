// One-shot loader: fetches NYC's HPD building dataset, aggregates to
// project rows, and bulk-inserts into Postgres. Idempotent — re-running
// upserts existing projects in place.
//
//   DATABASE_URL=postgres://... node scripts/load-pg.mjs
//
// Reads .env / .env.local for DATABASE_URL too, so local dev just needs
// a file with that variable set. Supabase, Neon, local PostGIS all work
// as long as the connection string is valid and PostGIS is enabled
// (Supabase has it on by default).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import pg from "pg";

const ENDPOINT = "https://data.cityofnewyork.us/resource/hg8x-zxpr.json";

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set. Add it to .env.local or your shell.");
  process.exit(1);
}

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase serves over TLS but with a Supabase-issued cert. The default
  // node-postgres SSL config validates against system CA bundle which
  // doesn't include it; this relaxes that check.
  ssl: process.env.DATABASE_URL.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : false,
});

async function applySchema(client) {
  const schemaPath = path.resolve(process.cwd(), "db/schema.sql");
  if (!existsSync(schemaPath)) {
    throw new Error("db/schema.sql missing");
  }
  const sql = readFileSync(schemaPath, "utf8");
  console.log("applying schema...");
  await client.query(sql);
}

async function fetchPage(offset, limit = 5000) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("$limit", String(limit));
  url.searchParams.set("$offset", String(offset));
  url.searchParams.set("$order", "project_start_date DESC");
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`socrata ${resp.status}: ${resp.statusText} :: ${await resp.text()}`);
  return resp.json();
}

function num(v) {
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function emptyProject(row, cityId) {
  return {
    city_id: cityId,
    external_id: row.project_id,
    name: (row.project_name || "").trim() || "(unnamed)",
    address: [row.house_number, row.street_name].filter(Boolean).join(" ").trim() || null,
    borough: row.borough || null,
    neighborhood: row.neighborhood_tabulation_area || null,
    postcode: row.postcode || null,
    council_district: row.council_district || null,
    community_board: row.community_board || null,
    construction_type: row.reporting_construction_type || null,
    extended_affordability: row.extended_affordability_status === "Yes",
    prevailing_wage: row.prevailing_wage_status === "Prevailing Wage",
    start_date: row.project_start_date ? row.project_start_date.slice(0, 10) : null,
    completion_date: null, // not in this dataset
    buildings_count: 0,
    lat_sum: 0,
    lng_sum: 0,
    units_total: 0,
    units_counted: 0,
    units_rental: 0,
    units_homeownership: 0,
    units_extremely_low: 0,
    units_very_low: 0,
    units_low: 0,
    units_moderate: 0,
    units_middle: 0,
    units_other_income: 0,
    units_studio: 0,
    units_1br: 0,
    units_2br: 0,
    units_3br: 0,
    units_4plus_br: 0,
  };
}

function fold(p, row) {
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    p.lat_sum += lat;
    p.lng_sum += lng;
    p.buildings_count += 1;
  }
  p.units_total += num(row.total_units);
  p.units_counted += num(row.all_counted_units);
  p.units_rental += num(row.counted_rental_units);
  p.units_homeownership += num(row.counted_homeownership_units);
  p.units_extremely_low += num(row.extremely_low_income_units);
  p.units_very_low += num(row.very_low_income_units);
  p.units_low += num(row.low_income_units);
  p.units_moderate += num(row.moderate_income_units);
  p.units_middle += num(row.middle_income_units);
  p.units_other_income += num(row.other_income_units);
  p.units_studio += num(row.studio_units);
  p.units_1br += num(row._1_br_units);
  p.units_2br += num(row._2_br_units);
  p.units_3br += num(row._3_br_units);
  p.units_4plus_br += num(row._4_br_units) + num(row._5_br_units) + num(row._6_br_units);
}

const UPSERT_SQL = `
INSERT INTO projects (
  city_id, external_id, name, address, borough, neighborhood, postcode,
  council_district, community_board, construction_type,
  extended_affordability, prevailing_wage,
  start_date, completion_date, geom,
  units_total, units_counted, units_rental, units_homeownership,
  units_extremely_low, units_very_low, units_low, units_moderate,
  units_middle, units_other_income,
  units_studio, units_1br, units_2br, units_3br, units_4plus_br,
  buildings_count, imported_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,
  $8,$9,$10,
  $11,$12,
  $13,$14, ST_SetSRID(ST_MakePoint($15,$16),4326)::geography,
  $17,$18,$19,$20,
  $21,$22,$23,$24,
  $25,$26,
  $27,$28,$29,$30,$31,
  $32, NOW()
)
ON CONFLICT (city_id, external_id) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  borough = EXCLUDED.borough,
  neighborhood = EXCLUDED.neighborhood,
  postcode = EXCLUDED.postcode,
  council_district = EXCLUDED.council_district,
  community_board = EXCLUDED.community_board,
  construction_type = EXCLUDED.construction_type,
  extended_affordability = EXCLUDED.extended_affordability,
  prevailing_wage = EXCLUDED.prevailing_wage,
  start_date = EXCLUDED.start_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_homeownership = EXCLUDED.units_homeownership,
  units_extremely_low = EXCLUDED.units_extremely_low,
  units_very_low = EXCLUDED.units_very_low,
  units_low = EXCLUDED.units_low,
  units_moderate = EXCLUDED.units_moderate,
  units_middle = EXCLUDED.units_middle,
  units_other_income = EXCLUDED.units_other_income,
  units_studio = EXCLUDED.units_studio,
  units_1br = EXCLUDED.units_1br,
  units_2br = EXCLUDED.units_2br,
  units_3br = EXCLUDED.units_3br,
  units_4plus_br = EXCLUDED.units_4plus_br,
  buildings_count = EXCLUDED.buildings_count,
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    await applySchema(client);

    const cityId = "nyc";
    const byProject = new Map();
    let offset = 0;
    const limit = 5000;
    let rawCount = 0;

    while (true) {
      process.stdout.write(`\rfetching offset ${offset}...`);
      const page = await fetchPage(offset, limit);
      if (!page.length) break;
      rawCount += page.length;
      for (const row of page) {
        const id = row.project_id;
        if (!id) continue;
        let p = byProject.get(id);
        if (!p) {
          p = emptyProject(row, cityId);
          byProject.set(id, p);
        }
        fold(p, row);
      }
      if (page.length < limit) break;
      offset += limit;
    }
    process.stdout.write("\n");

    const projects = [];
    for (const p of byProject.values()) {
      if (p.buildings_count === 0) continue;
      p.lat = p.lat_sum / p.buildings_count;
      p.lng = p.lng_sum / p.buildings_count;
      delete p.lat_sum;
      delete p.lng_sum;
      projects.push(p);
    }
    console.log(`upserting ${projects.length} projects from ${rawCount} building rows...`);

    await client.query("BEGIN");
    for (const p of projects) {
      await client.query(UPSERT_SQL, [
        p.city_id, p.external_id, p.name, p.address, p.borough, p.neighborhood, p.postcode,
        p.council_district, p.community_board, p.construction_type,
        p.extended_affordability, p.prevailing_wage,
        p.start_date, p.completion_date, p.lng, p.lat,
        p.units_total, p.units_counted, p.units_rental, p.units_homeownership,
        p.units_extremely_low, p.units_very_low, p.units_low, p.units_moderate,
        p.units_middle, p.units_other_income,
        p.units_studio, p.units_1br, p.units_2br, p.units_3br, p.units_4plus_br,
        p.buildings_count,
      ]);
    }
    await client.query(
      "UPDATE cities SET fetched_at = NOW() WHERE id = $1",
      [cityId],
    );
    await client.query("COMMIT");
    console.log("done.");
  } catch (e) {
    await pool.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
