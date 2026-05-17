// Council / supervisor / ward district boundary loader. Pulls polygon
// layers for every city that doesn't carry council_district on the
// project record, ingests them into council_districts, and then runs a
// spatial-join UPDATE that fills in projects.council_district by
// point-in-polygon. Idempotent.
//
//   node scripts/load-districts.mjs
//
// Why: most cities publish their affordable-housing data as flat tables
// without a council district column, but every city also publishes a
// district boundary layer. Joining the two in PostGIS is the only
// reliable way to get a per-project district number. NYC + DC + Austin
// already carry it on the source feed; everyone else needs the join.
//
// Sources:
//   bos  Boston BPDA "City Council Districts" feature service
//   sea  seattleio/seattle-boundaries-data github geojson
//   chi  data.cityofchicago.org Boundaries - Wards (2023-)
//   phl  Philly OpenData "Council_Districts_2024" feature service
//   sfo  data.sfgov.org Current Supervisor Districts
//   lax  LA City Council Districts (Adopted 2021) via ArcGIS Hub

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

// ---- geometry conversion helpers ----

// ArcGIS rings -> GeoJSON Polygon coordinates. ArcGIS doesn't separate
// outer rings from holes via geometry — it uses winding order — but for
// our purposes (one outer ring per feature is typical for districts),
// we treat the first ring as outer and the rest as holes.
function arcgisFeatureToGeoJSON(feat) {
  const rings = feat.geometry?.rings;
  if (!rings?.length) return null;
  return { type: "Polygon", coordinates: rings };
}

// Wrap a Polygon as a single-Polygon MultiPolygon so the column type
// stays consistent.
function asMultiPolygon(geom) {
  if (!geom) return null;
  if (geom.type === "MultiPolygon") return geom;
  if (geom.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geom.coordinates] };
  }
  return null;
}

async function fetchJson(url, headers = {}) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "groundwork-loader", ...headers },
  });
  if (!resp.ok) throw new Error(`${url}: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

// ---- per-city pullers. each returns [{ district, geom }, ...] ----

async function pullBoston() {
  const url =
    "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Boston_City_Council_Districts/FeatureServer/7/query?where=1%3D1&outFields=DISTRICT&outSR=4326&returnGeometry=true&f=json";
  const j = await fetchJson(url);
  return (j.features ?? [])
    .map((f) => {
      const geom = asMultiPolygon(arcgisFeatureToGeoJSON(f));
      const d = f.attributes?.DISTRICT;
      if (!geom || d == null) return null;
      return { district: String(d), geom };
    })
    .filter(Boolean);
}

async function pullSeattle() {
  const url =
    "https://raw.githubusercontent.com/seattleio/seattle-boundaries-data/master/data/city-council-districts.geojson";
  const j = await fetchJson(url);
  return (j.features ?? [])
    .map((f) => {
      const geom = asMultiPolygon(f.geometry);
      const d = f.properties?.district;
      if (!geom || d == null) return null;
      return { district: String(d), geom };
    })
    .filter(Boolean);
}

async function pullChicago() {
  // Socrata returns ward records with a `the_geom` MultiPolygon.
  const url =
    "https://data.cityofchicago.org/resource/p293-wvbd.json?$select=ward,the_geom&$limit=100";
  const j = await fetchJson(url);
  return j
    .map((r) => {
      const geom = asMultiPolygon(r.the_geom);
      if (!geom || r.ward == null) return null;
      return { district: String(parseInt(r.ward, 10)), geom };
    })
    .filter(Boolean);
}

async function pullPhilly() {
  const url =
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Council_Districts_2024/FeatureServer/0/query?where=1%3D1&outFields=district_num&outSR=4326&returnGeometry=true&f=json";
  const j = await fetchJson(url);
  return (j.features ?? [])
    .map((f) => {
      const geom = asMultiPolygon(arcgisFeatureToGeoJSON(f));
      const d = f.attributes?.district_num;
      if (!geom || d == null) return null;
      return { district: String(parseInt(d, 10)), geom };
    })
    .filter(Boolean);
}

async function pullSF() {
  // Current supervisor districts on the SF open-data portal.
  const url =
    "https://data.sfgov.org/resource/cqbw-m5m3.json?$select=sup_dist_num,multipolygon&$limit=20";
  const j = await fetchJson(url);
  return j
    .map((r) => {
      const geom = asMultiPolygon(r.multipolygon);
      if (!geom || r.sup_dist_num == null) return null;
      return { district: String(parseInt(r.sup_dist_num, 10)), geom };
    })
    .filter(Boolean);
}

async function pullLA() {
  // LA City Council Districts (Adopted 2021), exported as GeoJSON.
  const url =
    "https://opendata.arcgis.com/api/v3/datasets/76104f230e384f38871eb3c4782f903d_13/downloads/data?format=geojson&spatialRefId=4326";
  const j = await fetchJson(url);
  return (j.features ?? [])
    .map((f) => {
      const geom = asMultiPolygon(f.geometry);
      const d = f.properties?.District;
      if (!geom || d == null) return null;
      return { district: String(parseInt(d, 10)), geom };
    })
    .filter(Boolean);
}

const PULLERS = [
  ["bos", pullBoston],
  ["sea", pullSeattle],
  ["chi", pullChicago],
  ["phl", pullPhilly],
  ["sfo", pullSF],
  ["lax", pullLA],
];

const UPSERT_SQL = `
INSERT INTO council_districts (city_id, district, geom, imported_at)
VALUES (
  $1, $2,
  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))::geography,
  NOW()
)
ON CONFLICT (city_id, district) DO UPDATE SET
  geom = EXCLUDED.geom,
  imported_at = NOW();
`;

// Backfill project.council_district for any project whose district is
// null (or stale) using a single spatial join per city. We don't
// overwrite cities whose feed already carries the field accurately
// (NYC, DC, Austin) — they're skipped by the WHERE clause.
const BACKFILL_SQL = `
UPDATE projects p
SET council_district = d.district
FROM council_districts d
WHERE p.city_id = $1
  AND d.city_id = $1
  AND (p.council_district IS NULL OR p.council_district = '')
  AND ST_Intersects(p.geom, d.geom);
`;

async function main() {
  const client = await pool.connect();
  try {
    // Ensure council_districts table exists in case the schema was last
    // applied before this loader was introduced.
    await client.query(`
      CREATE TABLE IF NOT EXISTS council_districts (
        city_id     TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
        district    TEXT NOT NULL,
        geom        GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (city_id, district)
      );
      CREATE INDEX IF NOT EXISTS council_districts_geom_idx ON council_districts USING GIST (geom);
      CREATE INDEX IF NOT EXISTS council_districts_city_idx ON council_districts (city_id);
    `);

    for (const [cityId, puller] of PULLERS) {
      try {
        console.log(`[${cityId}] fetching...`);
        const rows = await puller();
        if (!rows.length) {
          console.log(`[${cityId}] no rows returned; skipping`);
          continue;
        }
        await client.query("BEGIN");
        for (const r of rows) {
          await client.query(UPSERT_SQL, [
            cityId,
            r.district,
            JSON.stringify(r.geom),
          ]);
        }
        const backfill = await client.query(BACKFILL_SQL, [cityId]);
        await client.query("COMMIT");
        console.log(
          `[${cityId}] loaded ${rows.length} districts, backfilled ${backfill.rowCount ?? 0} projects`,
        );
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[${cityId}] failed:`, e.message);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
