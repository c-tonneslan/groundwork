// Austin Affordable Housing Inventory loader. Austin's open-data portal
// runs Socrata at data.austintexas.gov.
//
//   node scripts/load-aus.mjs
//
// HEADS UP: the dataset id below is the long-standing public "Affordable
// Housing Inventory" feed. If Austin renames or replaces it, set
// AUS_DATASET_ID in .env.local to override. Pulling roughly 1,500 rows.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const CITY_ID = "aus";
const DATASET_ID = process.env.AUS_DATASET_ID || "x4ar-3p32";
const ENDPOINT = `https://data.austintexas.gov/resource/${DATASET_ID}.json`;

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : false,
});

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function fetchAll() {
  const out = [];
  let offset = 0;
  const limit = 5000;
  while (true) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("$limit", String(limit));
    url.searchParams.set("$offset", String(offset));
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`socrata ${resp.status}: ${resp.statusText}`);
    const page = await resp.json();
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }
  return out;
}

// Convert Austin's "12-31-2024" / "2024-12-31" / null into ISO YYYY-MM-DD.
function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  // 12-21-2000 style (US)
  const us = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  // already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function toProject(r, i) {
  const lat = parseFloat(r.latitude);
  const lng = parseFloat(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Austin records both total and affordable counts. We use affordable
  // since this is the affordable-housing inventory; total includes
  // market-rate units in mixed-income developments.
  const totalUnits = num(r.affordable_units ?? r.total_units);
  const isRental = String(r.housing_tenure || "").toLowerCase().includes("rent");

  return {
    city_id: CITY_ID,
    external_id: String(r.project_id || r.contract_id || `aus-${i}`),
    name: (r.project_name || r.address || "(unnamed)").toString().trim(),
    address: r.address || null,
    borough: r.council_district ? `District ${r.council_district}` : null,
    neighborhood: null,
    postcode: r.zip || null,
    council_district: r.council_district ? String(r.council_district) : null,
    community_board: null,
    construction_type: r.unit_type || null,
    extended_affordability: String(r.affordability_period || "").length > 0 && Number(r.affordability_period) >= 40,
    prevailing_wage: false,
    // Austin tracks affordability_start_date (when the regulatory
    // period begins, usually placement-in-service). Storing as
    // start_date lets the existing trends + expiring views work.
    start_date: parseDate(r.affordability_start_date),
    // affordability_expiration_date isn't a "completion" but it's the
    // closest thing to one we get here; storing it lets the +30y heuristic
    // in /api/expiring at least be in the right ballpark for Austin,
    // and the per-project page will show the real expiration date.
    completion_date: parseDate(r.affordability_expiration_date),
    buildings_count: 1,
    lat,
    lng,
    units_total: totalUnits,
    units_counted: totalUnits,
    units_rental: isRental ? totalUnits : 0,
    units_homeownership: isRental ? 0 : totalUnits,
    units_extremely_low: num(r.mfi_20) + num(r.mfi_30),
    units_very_low: num(r.mfi_40) + num(r.mfi_50),
    units_low: num(r.mfi_60) + num(r.mfi_65) + num(r.mfi_70) + num(r.mfi_80),
    units_moderate: num(r.mfi_100),
    units_middle: num(r.mfi_120),
    units_other_income: 0,
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
  borough = EXCLUDED.borough,
  neighborhood = EXCLUDED.neighborhood,
  postcode = EXCLUDED.postcode,
  council_district = EXCLUDED.council_district,
  construction_type = EXCLUDED.construction_type,
  completion_date = EXCLUDED.completion_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_homeownership = EXCLUDED.units_homeownership,
  units_extremely_low = EXCLUDED.units_extremely_low,
  units_very_low = EXCLUDED.units_very_low,
  units_low = EXCLUDED.units_low,
  units_studio = EXCLUDED.units_studio,
  units_1br = EXCLUDED.units_1br,
  units_2br = EXCLUDED.units_2br,
  units_3br = EXCLUDED.units_3br,
  units_4plus_br = EXCLUDED.units_4plus_br,
  imported_at = NOW();
`;

async function ensureCity(client) {
  await client.query(
    `INSERT INTO cities (id, name, center_lat, center_lng, default_zoom, data_source, data_source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, center_lat = EXCLUDED.center_lat,
       center_lng = EXCLUDED.center_lng, default_zoom = EXCLUDED.default_zoom,
       data_source = EXCLUDED.data_source, data_source_url = EXCLUDED.data_source_url`,
    [
      CITY_ID,
      "Austin",
      30.2672,
      -97.7431,
      12,
      "City of Austin Affordable Housing Inventory",
      `https://data.austintexas.gov/resource/${DATASET_ID}`,
    ],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureCity(client);
    console.log(`fetching Austin records from Socrata ${DATASET_ID}...`);
    const records = await fetchAll();
    console.log(`got ${records.length} records`);
    const projects = records.map(toProject).filter(Boolean);
    console.log(`upserting ${projects.length} with valid coordinates...`);

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
