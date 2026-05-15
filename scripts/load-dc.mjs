// DC Affordable Housing loader. Pulls every record from the DCGIS
// ArcGIS feature service (~900 projects) and maps onto the projects
// schema.
//
//   node scripts/load-dc.mjs
//
// This is one of the richer datasets we ingest: it has an AMI-bucket
// breakdown that maps cleanly onto our HUD-style income tiers, plus
// ward (council district), construction end date, and total/market/
// affordable unit counts. ArcGIS REST returns x,y as lng,lat.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const ENDPOINT =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/62/query";
const CITY_ID = "dc";

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
  // ArcGIS REST pages at 2000 per request; loop until exceededTransferLimit
  // goes away. DC has ~922 features so usually one page does it.
  const out = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      outSR: "4326",
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

// MAR_WARD is "Ward 8" / "Ward 1" — strip to the digit so it matches
// council_members.district format.
function wardToDistrict(w) {
  if (!w) return null;
  const m = String(w).match(/(\d+)/);
  return m ? m[1] : null;
}

function toProject(feat) {
  const a = feat.attributes || {};
  const g = feat.geometry || {};
  const lat = parseFloat(a.LATITUDE) || g.y;
  const lng = parseFloat(a.LONGITUDE) || g.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!a.PROJECT_NAME && !a.ADDRESS) return null;

  // AMI buckets map onto HUD's standard 30/50/60/80/120 cutoffs.
  // DC uses 0-30 (extremely low), 31-50 (very low), 51-60 (low), 61-80
  // (low+), 81+ (anything above 80% AMI — we put in moderate).
  const xLow = num(a.AFFORDABLE_UNITS_AT_0_30_AMI);
  const vLow = num(a.AFFORDABLE_UNITS_AT_31_50_AMI);
  const low = num(a.AFFORDABLE_UNITS_AT_51_60_AMI) + num(a.AFFORDABLE_UNITS_AT_61_80_AMI);
  const moderate = num(a.AFFORDABLE_UNITS_AT_81_AMI);

  const totalAffordable = num(a.TOTAL_AFFORDABLE_UNITS);
  const totalAll = num(a.UNITS_TOTAL) || totalAffordable;
  // Whatever isn't bucketed gets dumped into "other" so totals match.
  const bucketed = xLow + vLow + low + moderate;
  const other = Math.max(0, totalAffordable - bucketed);

  // STATUS_PUBLIC is "Completed 2015 to Date" or "Under Construction" etc.
  const status = (a.STATUS_PUBLIC || "").toLowerCase();
  let constructionType = null;
  if (status.includes("preserv") || num(a.AFFORDABLE_UNITS_PRESERVED) > num(a.AFFORDABLE_UNITS_PRODUCTION)) {
    constructionType = "Preservation";
  } else if (num(a.AFFORDABLE_UNITS_PRODUCTION) > 0 || num(a.UNITS_NET_NEW) > 0) {
    constructionType = "New Construction";
  }

  // CONSTRUCTION_END_DATE is unix ms.
  let completionDate = null;
  if (typeof a.CONSTRUCTION_END_DATE === "number" && a.CONSTRUCTION_END_DATE > 0) {
    completionDate = new Date(a.CONSTRUCTION_END_DATE).toISOString().slice(0, 10);
  }

  return {
    city_id: CITY_ID,
    external_id: String(a.OBJECTID),
    name: (a.PROJECT_NAME || a.ADDRESS || "(unnamed)").trim(),
    address: a.ADDRESS || a.FULLADDRESS || null,
    borough: a.PLANNING_AREA || null,
    neighborhood: a.PLANNING_AREA || null,
    postcode: null,
    council_district: wardToDistrict(a.MAR_WARD),
    community_board: null,
    construction_type: constructionType,
    extended_affordability: false,
    prevailing_wage: false,
    start_date: null,
    completion_date: completionDate,
    buildings_count: 1,
    lat,
    lng,
    units_total: totalAll,
    units_counted: totalAffordable,
    units_rental: totalAffordable,
    units_homeownership: 0,
    units_extremely_low: xLow,
    units_very_low: vLow,
    units_low: low,
    units_moderate: moderate,
    units_middle: 0,
    units_other_income: other,
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
  council_district = EXCLUDED.council_district,
  construction_type = EXCLUDED.construction_type,
  completion_date = EXCLUDED.completion_date,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_extremely_low = EXCLUDED.units_extremely_low,
  units_very_low = EXCLUDED.units_very_low,
  units_low = EXCLUDED.units_low,
  units_moderate = EXCLUDED.units_moderate,
  units_other_income = EXCLUDED.units_other_income,
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("fetching DC affordable housing inventory...");
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
