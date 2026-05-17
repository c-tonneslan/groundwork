// Seattle LIHTC loader — uses HUD's national Low-Income Housing Tax
// Credit FeatureServer filtered to PROJ_CTY='SEATTLE' AND PROJ_ST='WA'.
//
//   node scripts/load-sea.mjs
//
// Why this instead of data.seattle.gov: Seattle's own open-data portal
// doesn't publish a project-level affordable housing inventory. The
// Office of Housing keeps theirs in dashboards and PDFs. HUD's LIHTC
// database is the next-best primary source — it covers every LIHTC
// project nationwide (~40k records), is geocoded, and is updated
// annually.
//
// What you get: ~297 Seattle LIHTC properties placed in service from
// 1987 onward with addresses, unit + low-income unit counts, bedroom
// mix, year placed in service, and the HUD project id. What you don't
// get: per-tier AMI breakdowns (HUD reports a ceiling, not a unit
// count per tier), construction-type, or council district.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const CITY_ID = "sea";
const ENDPOINT =
  "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0/query";

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
  while (true) {
    const params = new URLSearchParams({
      where: "PROJ_CTY='SEATTLE' AND PROJ_ST='WA'",
      outFields: "*",
      outSR: "4326",
      returnGeometry: "true",
      f: "json",
      resultOffset: String(offset),
      resultRecordCount: "2000",
    });
    const resp = await fetch(`${ENDPOINT}?${params}`);
    if (!resp.ok) throw new Error(`arcgis ${resp.status}: ${resp.statusText}`);
    const json = await resp.json();
    const feats = json.features ?? [];
    out.push(...feats);
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  return out;
}

function toProject(feat) {
  const a = feat.attributes || {};
  const g = feat.geometry || {};
  const lat = g.y;
  const lng = g.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const total = num(a.N_UNITS);
  const lowIncome = num(a.LI_UNITS);
  const yearPIS = a.YR_PIS && /^\d{4}$/.test(String(a.YR_PIS)) ? Number(a.YR_PIS) : null;
  const yearAlloc = a.YR_ALLOC && /^\d{4}$/.test(String(a.YR_ALLOC)) ? Number(a.YR_ALLOC) : null;

  const completionDate = yearPIS ? `${yearPIS}-01-01` : null;
  // For start date, use allocation year if before PIS, otherwise null.
  // Treating allocation as "start" is a stretch but matches what other
  // cities call start (commitment, not groundbreaking).
  const startDate =
    yearAlloc && (!yearPIS || yearAlloc <= yearPIS) ? `${yearAlloc}-01-01` : null;

  // BOND='1' means bond-financed (4% credit). TYPE='2' is acquisition+rehab.
  const constructionType =
    a.TYPE === "1" ? "New Construction" : a.TYPE === "2" ? "Acquisition + Rehab" : null;

  return {
    city_id: CITY_ID,
    external_id: String(a.HUD_ID || a.OBJECTID),
    name: (a.PROJECT || a.STD_ADDR || a.PROJ_ADD || "(unnamed)").toString().trim(),
    address: a.STD_ADDR || a.PROJ_ADD || null,
    borough: null, // HUD doesn't tag a neighborhood
    neighborhood: null,
    postcode: a.STD_ZIP5 || a.PROJ_ZIP || null,
    council_district: null,
    community_board: null,
    construction_type: constructionType,
    extended_affordability: false,
    prevailing_wage: false,
    start_date: startDate,
    completion_date: completionDate,
    buildings_count: 1,
    lat,
    lng,
    units_total: total,
    units_counted: lowIncome,
    units_rental: lowIncome, // LIHTC is rental-only
    units_homeownership: 0,
    units_extremely_low: 0,
    units_very_low: 0,
    units_low: 0,
    units_moderate: 0,
    units_middle: 0,
    units_other_income: lowIncome,
    units_studio: num(a.N_0BR),
    units_1br: num(a.N_1BR),
    units_2br: num(a.N_2BR),
    units_3br: num(a.N_3BR),
    units_4plus_br: num(a.N_4BR),
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
  postcode = EXCLUDED.postcode,
  construction_type = EXCLUDED.construction_type,
  start_date = EXCLUDED.start_date,
  completion_date = EXCLUDED.completion_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_other_income = EXCLUDED.units_other_income,
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
      "Seattle",
      47.6062,
      -122.3321,
      12,
      "HUD National LIHTC Database (Seattle subset)",
      "https://www.huduser.gov/portal/datasets/lihtc/property.html",
    ],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureCity(client);
    console.log("fetching HUD LIHTC records for Seattle, WA...");
    const features = await fetchAll();
    console.log(`got ${features.length} features`);
    const projects = features.map(toProject).filter(Boolean);
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
