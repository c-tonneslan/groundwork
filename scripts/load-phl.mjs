// Philadelphia Affordable Housing Production loader. Pulls every
// project from the city's ArcGIS feature service (~490 records).
//
//   node scripts/load-phl.mjs
//
// Schema is lean: project name, developer, address, total units, type
// (rental/ownership), status, development type (preservation vs new).
// No AMI breakdown and no council district — Phila's 17 council districts
// aren't on the record; addresses are present so a future spatial join
// against the council boundary layer could fill them in.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const ENDPOINT =
  "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/AffordableHousingProduction/FeatureServer/0/query";
const CITY_ID = "phl";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase")
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
      where: "1=1",
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

  const units = num(a.total_units);
  const isRental = (a.project_type || "").toLowerCase() === "rental";

  // development_type: "New Construction", "Preservation (occupied)", etc.
  const dt = (a.development_type || "").toLowerCase();
  let constructionType = null;
  if (dt.includes("new construction")) constructionType = "New Construction";
  else if (dt.includes("preservation")) constructionType = "Preservation";
  else if (a.development_type) constructionType = a.development_type;

  // fiscal_year_complete is sometimes just a year like 2018 — fold to 1/1.
  let completionDate = null;
  if (a.fiscal_year_complete && /^\d{4}$/.test(String(a.fiscal_year_complete))) {
    completionDate = `${a.fiscal_year_complete}-01-01`;
  }

  return {
    city_id: CITY_ID,
    external_id: String(a.objectid),
    name: (a.project_name || a.address || "(unnamed)").trim(),
    address: a.address || null,
    borough: null,
    neighborhood: null,
    postcode: null,
    council_district: null,
    community_board: null,
    construction_type: constructionType,
    extended_affordability: false,
    prevailing_wage: false,
    start_date: null,
    completion_date: completionDate,
    buildings_count: 1,
    lat,
    lng,
    units_total: units,
    units_counted: units,
    units_rental: isRental ? units : 0,
    units_homeownership: isRental ? 0 : units,
    units_extremely_low: 0,
    units_very_low: 0,
    units_low: 0,
    units_moderate: 0,
    units_middle: 0,
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
  construction_type = EXCLUDED.construction_type,
  completion_date = EXCLUDED.completion_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_homeownership = EXCLUDED.units_homeownership,
  units_other_income = EXCLUDED.units_other_income,
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("fetching Philadelphia affordable housing production...");
    const features = await fetchAll();
    console.log(`got ${features.length} features`);
    const projects = features.map(toProject).filter(Boolean);
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
