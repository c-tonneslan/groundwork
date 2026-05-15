// SF (MOHCD) affordable housing pipeline loader. Pulls every row from
// the SF Open Data Socrata endpoint, maps onto the same `projects`
// table schema NYC uses, and upserts.
//
//   node scripts/load-sfo.mjs

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const ENDPOINT = "https://data.sfgov.org/resource/aaxw-2cb8.json";
const CITY_ID = "sfo";

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
  // SF's pipeline dataset is small (~250 rows), one page is enough.
  const url = new URL(ENDPOINT);
  url.searchParams.set("$limit", "5000");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`socrata ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

// Map MOHCD's AMI-percentage columns onto the HUD income brackets the
// schema uses. Boundaries follow HUD's standard cutoffs.
function aggregateIncome(row) {
  const at = (k) => num(row[k]);
  return {
    extremelyLow: at("_20_ami") + at("_30_ami"),
    veryLow: at("_40_ami") + at("_50_ami"),
    low: at("_55_ami") + at("_60_ami") + at("_80_ami"),
    moderate:
      at("_90_ami") +
      at("_100_ami") +
      at("_105_ami") +
      at("_110_ami") +
      at("_120_ami"),
    middle: at("_130_ami") + at("_150_ami"),
    other: at("ami_undeclared"),
  };
}

function toProject(row) {
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const income = aggregateIncome(row);

  // MOHCD records the "general_housing_program" + "project_type" combo,
  // which we squash into a single string that matches the construction
  // type bucket NYC uses.
  let constructionType = null;
  const pt = (row.project_type || "").toLowerCase();
  if (pt.includes("new construction")) constructionType = "New Construction";
  else if (pt.includes("rehab") || pt.includes("preservation"))
    constructionType = "Preservation";
  else if (pt) constructionType = row.project_type;

  return {
    city_id: CITY_ID,
    external_id: row.project_id,
    name: (row.project_name || "").trim() || "(unnamed)",
    address: row.plannning_approval_address || null,
    borough: row.city_analysis_neighborhood || row.planning_neighborhood || null,
    neighborhood: row.planning_neighborhood || null,
    postcode: row.zip_code || null,
    council_district: row.supervisor_district || null,
    community_board: null,
    construction_type: constructionType,
    extended_affordability: false, // not tracked at this granularity
    prevailing_wage: false,
    start_date: row.entitlement_approval ? row.entitlement_approval.slice(0, 10) : null,
    completion_date: null,
    buildings_count: 1, // pipeline records one row per project, no building rollup
    lat,
    lng,
    units_total: num(row.total_project_units),
    units_counted: num(row.mohcd_affordable_units),
    units_rental: (row.housing_tenure || "").toLowerCase() === "rental" ? num(row.mohcd_affordable_units) : 0,
    units_homeownership: (row.housing_tenure || "").toLowerCase() === "ownership" ? num(row.mohcd_affordable_units) : 0,
    units_extremely_low: income.extremelyLow,
    units_very_low: income.veryLow,
    units_low: income.low,
    units_moderate: income.moderate,
    units_middle: income.middle,
    units_other_income: income.other,
    units_studio: num(row.studio_units),
    units_1br: num(row._1bd_units),
    units_2br: num(row._2bd_units),
    units_3br: num(row._3bd_units),
    units_4plus_br: num(row._4bd_units) + num(row._5_bd_units),
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
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("fetching SF MOHCD pipeline...");
    const rows = await fetchAll();
    console.log(`got ${rows.length} pipeline rows`);
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
