// LAHD "Affordable Housing Projects List" loader. Pulls every LA
// affordable project funded since 2003 (~600 records) and maps onto
// the projects schema.
//
//   node scripts/load-la.mjs
//
// This dataset is richer than Chicago's: it has council district,
// developer name, dates, and a development_stage (Development vs
// In-Service) which we squash into construction type.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const ENDPOINT = "https://data.lacity.org/resource/mymu-zi3s.json";
const CITY_ID = "lax";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase")
    ? { rejectUnauthorized: false }
    : false,
});

function num(v) {
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAll() {
  // LAHD dataset is ~615 rows total. One page covers everything.
  const url = new URL(ENDPOINT);
  url.searchParams.set("$limit", "5000");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`socrata ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

function toProject(row) {
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const ct = (row.construction_type || "").toUpperCase();
  let constructionType = null;
  if (ct.includes("REHAB")) constructionType = "Preservation";
  else if (ct.includes("NEW")) constructionType = "New Construction";
  else if (ct) constructionType = row.construction_type;

  const units = num(row.project_total_units);

  // LA records funding date and "in-service" year separately; treat
  // funding date as the project start.
  const startDate = row.date_funded ? row.date_funded.slice(0, 10) : null;
  // in_service_date is just a year ("2012"); fold to YYYY-01-01.
  let completionDate = null;
  if (row.in_service_date && /^\d{4}$/.test(row.in_service_date)) {
    completionDate = `${row.in_service_date}-01-01`;
  }

  return {
    city_id: CITY_ID,
    external_id: row.project_number + (row.site_cd ? `-${row.site_cd}` : ""),
    name: (row.name || "").trim() || "(unnamed)",
    address: row.address || null,
    borough: null,
    neighborhood: null,
    postcode: null,
    council_district: row.council_district || null,
    community_board: null,
    construction_type: constructionType,
    extended_affordability: false,
    prevailing_wage: false,
    start_date: startDate,
    completion_date: completionDate,
    buildings_count: 1,
    lat,
    lng,
    units_total: units,
    units_counted: units,
    // LA doesn't split rental vs ownership in this dataset; treat as rental.
    units_rental: units,
    units_homeownership: 0,
    units_extremely_low: 0,
    units_very_low: 0,
    units_low: 0,
    units_moderate: 0,
    units_middle: 0,
    // No income tier breakdown in the source — bucket everything as "other"
    // so the comparison view still shows non-zero totals.
    units_other_income: units,
    units_studio: 0,
    units_1br: 0,
    units_2br: 0,
    units_3br: 0,
    units_4plus_br: 0,
  };
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
  council_district = EXCLUDED.council_district,
  construction_type = EXCLUDED.construction_type,
  start_date = EXCLUDED.start_date,
  completion_date = EXCLUDED.completion_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_other_income = EXCLUDED.units_other_income,
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("fetching LA LAHD affordable housing projects...");
    const rows = await fetchAll();
    console.log(`got ${rows.length} rows`);
    const projects = rows.map(toProject).filter(Boolean);
    console.log(`upserting ${projects.length} projects with valid coordinates...`);

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
    await client.query("UPDATE cities SET fetched_at = NOW() WHERE id = $1", [CITY_ID]);
    await client.query("COMMIT");
    console.log("done.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
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
