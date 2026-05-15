// Loads ACS 5-year tract-level demographics for every city in the DB.
//
//   CENSUS_API_KEY=... node scripts/load-census.mjs
//
// Pulls two things and joins them:
//   1. ACS 2022 5-year estimates via api.census.gov  (median income,
//      population, rent-burden split)
//   2. Tract MultiPolygon boundaries from the Census TIGERweb ArcGIS
//      REST endpoint
//
// Keyed by GEOID; idempotent upsert. Run once after `migrate.mjs`.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}
if (!process.env.CENSUS_API_KEY) {
  console.error("error: CENSUS_API_KEY is not set. Get one (free, instant) at https://api.census.gov/data/key_signup.html");
  process.exit(1);
}

const KEY = process.env.CENSUS_API_KEY;
const ACS_YEAR = 2022;

// Map cities to their FIPS counties. NYC is 5 counties (one per borough),
// SF is one county that maps 1:1 to the city/county boundary.
const CITY_COUNTIES = {
  nyc: { state: "36", counties: ["005", "047", "061", "081", "085"] },
  sfo: { state: "06", counties: ["075"] },
};

// ACS variables we want.
//   B01003_001E: total population
//   B19013_001E: median household income (12-month)
//   B25070_001E: total renter-occupied units (denominator for burden)
//   B25070_007E - B25070_010E: gross rent as % of income — 30%+ buckets
//   B25070_009E + B25070_010E: severe burden buckets (40%+, 50%+)
const VARS = [
  "B01003_001E",
  "B19013_001E",
  "B25070_001E",
  "B25070_007E",
  "B25070_008E",
  "B25070_009E",
  "B25070_010E",
];

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase")
    ? { rejectUnauthorized: false }
    : false,
});

function parseACS(rows, varNames) {
  // ACS returns CSV-as-JSON: first row is headers, subsequent are values.
  const [header, ...data] = rows;
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));
  return data.map((row) => {
    const out = { state: row[idx.state], county: row[idx.county], tract: row[idx.tract] };
    for (const v of varNames) out[v] = parseInt(row[idx[v]], 10);
    return out;
  });
}

async function fetchACS(state, counties) {
  const out = [];
  for (const county of counties) {
    const url = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
    url.searchParams.set("get", `NAME,${VARS.join(",")}`);
    url.searchParams.set("for", "tract:*");
    url.searchParams.set("in", `state:${state} county:${county}`);
    url.searchParams.set("key", KEY);
    const resp = await fetch(url);
    if (!resp.ok)
      throw new Error(`ACS ${state}/${county}: ${resp.status} ${resp.statusText}`);
    const rows = await resp.json();
    const parsed = parseACS(rows, VARS);
    out.push(...parsed);
  }
  return out;
}

async function fetchTractGeoms(state, counties) {
  // TIGERweb's tract layer (id 3) supports filtering and GeoJSON output.
  // We page through 1,000 features at a time.
  const out = [];
  for (const county of counties) {
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        where: `STATE='${state}' AND COUNTY='${county}'`,
        outFields: "GEOID,STATE,COUNTY,TRACT,NAME,BASENAME",
        f: "geojson",
        resultRecordCount: "1000",
        resultOffset: String(offset),
      });
      const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/3/query?${params}`;
      const resp = await fetch(url);
      if (!resp.ok)
        throw new Error(`TIGERweb ${state}/${county}: ${resp.status} ${resp.statusText}`);
      const fc = await resp.json();
      if (!fc.features || fc.features.length === 0) break;
      out.push(...fc.features);
      if (fc.features.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}

function normaliseGeometry(geom) {
  // TIGERweb may return Polygon or MultiPolygon. PostGIS wants MultiPolygon
  // for our column type, so wrap singletons.
  if (geom.type === "MultiPolygon") return geom;
  if (geom.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geom.coordinates] };
  }
  return null;
}

const UPSERT_SQL = `
INSERT INTO census_tracts (
  geoid, city_id, state_fips, county_fips, tract_fips, name,
  population, median_income, renter_households, rent_burdened, severely_rent_burdened,
  geom, imported_at
) VALUES (
  $1,$2,$3,$4,$5,$6,
  $7,$8,$9,$10,$11,
  ST_GeomFromGeoJSON($12)::geography, NOW()
)
ON CONFLICT (geoid) DO UPDATE SET
  city_id                = EXCLUDED.city_id,
  name                   = EXCLUDED.name,
  population             = EXCLUDED.population,
  median_income          = EXCLUDED.median_income,
  renter_households      = EXCLUDED.renter_households,
  rent_burdened          = EXCLUDED.rent_burdened,
  severely_rent_burdened = EXCLUDED.severely_rent_burdened,
  geom                   = EXCLUDED.geom,
  imported_at            = NOW();
`;

async function loadCity(cityId, client) {
  const cfg = CITY_COUNTIES[cityId];
  if (!cfg) {
    console.warn(`unknown city ${cityId}, skipping`);
    return;
  }
  console.log(`[${cityId}] fetching ACS for state ${cfg.state} counties ${cfg.counties.join(",")}...`);
  const acs = await fetchACS(cfg.state, cfg.counties);
  console.log(`[${cityId}]   got ${acs.length} ACS rows`);

  console.log(`[${cityId}] fetching tract geometries from TIGERweb...`);
  const geoms = await fetchTractGeoms(cfg.state, cfg.counties);
  console.log(`[${cityId}]   got ${geoms.length} tract polygons`);

  // Index ACS by 11-digit GEOID for join.
  const acsByGeoid = new Map();
  for (const r of acs) {
    const geoid = `${r.state}${r.county}${r.tract}`;
    acsByGeoid.set(geoid, r);
  }

  let inserted = 0;
  await client.query("BEGIN");
  try {
    for (const feat of geoms) {
      const p = feat.properties || {};
      const geoid = p.GEOID;
      if (!geoid) continue;
      const a = acsByGeoid.get(geoid);
      if (!a) continue;
      const geom = normaliseGeometry(feat.geometry);
      if (!geom) continue;

      // Negative values in ACS mean "not available" — null them out.
      const pop = a.B01003_001E < 0 ? null : a.B01003_001E;
      const median = a.B19013_001E < 0 ? null : a.B19013_001E;
      const renters = a.B25070_001E < 0 ? null : a.B25070_001E;
      const burdened30 = (a.B25070_007E < 0 ? 0 : a.B25070_007E)
        + (a.B25070_008E < 0 ? 0 : a.B25070_008E)
        + (a.B25070_009E < 0 ? 0 : a.B25070_009E)
        + (a.B25070_010E < 0 ? 0 : a.B25070_010E);
      const burdened50 = a.B25070_010E < 0 ? 0 : a.B25070_010E;

      await client.query(UPSERT_SQL, [
        geoid,
        cityId,
        p.STATE,
        p.COUNTY,
        p.TRACT,
        p.NAME || p.BASENAME || null,
        pop,
        median,
        renters,
        burdened30,
        burdened50,
        JSON.stringify(geom),
      ]);
      inserted++;
    }
    await client.query("COMMIT");
    console.log(`[${cityId}] upserted ${inserted} tracts`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    for (const cityId of Object.keys(CITY_COUNTIES)) {
      await loadCity(cityId, client);
    }
    console.log("done.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
