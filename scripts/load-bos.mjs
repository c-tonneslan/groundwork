// Boston Income-Restricted Housing loader.
//
//   node scripts/load-bos.mjs
//
// Boston publishes the inventory in two places. The data.boston.gov CKAN
// resource is purely tabular (no coordinates), so it can't be mapped.
// We instead use the ArcGIS feature service "Parcels with Income-
// Restricted Units" published by BPDA, which carries per-parcel
// geometry. Each parcel is a polygon; we collapse it to a centroid for
// the point geom column.
//
// Field truncations are real (Affordabl, Residenti, Stage_of, Complianc)
// — ArcGIS shapefile-origin layers cap field names at 10 chars.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const CITY_ID = "bos";
const ENDPOINT =
  "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Parcels_with_Income_Restricted_Units/FeatureServer/0/query";

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

function centroid(rings) {
  if (!rings?.length) return null;
  // Use the outer ring (first). Simple vertex-average; good enough for
  // urban parcels which are small + mostly convex.
  const ring = rings[0];
  if (!ring.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [x, y] of ring) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      sx += x;
      sy += y;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { lng: sx / n, lat: sy / n };
}

function toProject(feat) {
  const a = feat.attributes || {};
  const c = centroid(feat.geometry?.rings);
  if (!c) return null;

  // The full address field includes neighborhood/state/zip too; pull
  // those out into their own columns where possible.
  const addressRaw = (a.Address || "").trim();
  // "25 AMORY ST, Boston, MA, 02119" -> ["25 AMORY ST","Boston","MA","02119"]
  const parts = addressRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const street = parts[0] || null;
  const zip = parts[parts.length - 1] && /^\d{5}$/.test(parts[parts.length - 1])
    ? parts[parts.length - 1]
    : null;

  const totalUnits = num(a.Residenti);
  const affordable = num(a.Affordabl);
  // Compliance text like "Rental Unit Group (R)" vs "Ownership ..."
  const isRental = String(a.Complianc || "").toLowerCase().includes("rent");

  const name = a.Owner_1 && a.Owner_1.trim()
    ? `${street ?? "(parcel)"} (${a.Owner_1.trim()})`
    : street || "(parcel)";

  return {
    city_id: CITY_ID,
    external_id: String(a.Parcel_ID ?? a.FID),
    name,
    address: street,
    borough: null,
    neighborhood: null,
    postcode: zip,
    council_district: null,
    community_board: null,
    // Stage_of: e.g. "Under Construction", "Permitted", " " etc.
    construction_type:
      a.Stage_of && a.Stage_of.trim() && a.Stage_of !== "None"
        ? a.Stage_of.trim()
        : null,
    extended_affordability: false,
    prevailing_wage: false,
    start_date: null,
    completion_date: null,
    buildings_count: 1,
    lat: c.lat,
    lng: c.lng,
    // Counted units = affordable units; total = whole-building unit count.
    units_total: totalUnits || affordable,
    units_counted: affordable,
    units_rental: isRental ? affordable : 0,
    units_homeownership: isRental ? 0 : affordable,
    units_extremely_low: 0,
    units_very_low: 0,
    units_low: 0,
    units_moderate: 0,
    units_middle: 0,
    units_other_income: affordable,
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
  postcode = EXCLUDED.postcode,
  construction_type = EXCLUDED.construction_type,
  geom = EXCLUDED.geom,
  units_total = EXCLUDED.units_total,
  units_counted = EXCLUDED.units_counted,
  units_rental = EXCLUDED.units_rental,
  units_homeownership = EXCLUDED.units_homeownership,
  units_other_income = EXCLUDED.units_other_income,
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
      "Boston",
      42.3601,
      -71.0589,
      12,
      "BPDA Parcels with Income-Restricted Units",
      "https://data.boston.gov/dataset/income-restricted-housing",
    ],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureCity(client);
    console.log("fetching Boston BPDA parcels...");
    const features = await fetchAll();
    console.log(`got ${features.length} features`);
    const projects = features.map(toProject).filter(Boolean);
    console.log(`upserting ${projects.length} parcels with usable geometry...`);

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
