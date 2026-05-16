-- groundwork schema. Multi-city ready, PostGIS-backed.
--
-- Run once against a fresh Postgres instance (Supabase, Neon, local). The
-- `pg` driver in scripts/load-pg.mjs will execute this if the cities
-- table doesn't exist yet, so this file doubles as documentation and as
-- the canonical migration.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cities (
  id              TEXT PRIMARY KEY,           -- 'nyc', 'phl', 'sfo'
  name            TEXT NOT NULL,              -- display name
  center_lat      DOUBLE PRECISION NOT NULL,
  center_lng      DOUBLE PRECISION NOT NULL,
  default_zoom    REAL NOT NULL DEFAULT 11,
  data_source     TEXT,                       -- 'NYC HPD' etc.
  data_source_url TEXT,
  fetched_at      TIMESTAMPTZ
);

-- Affordable-housing (and eventually other civic) projects.
-- A "project" is one logical effort that may span multiple buildings.
-- The (city_id, external_id) composite key preserves source-specific
-- identifiers without collisions between cities.
CREATE TABLE IF NOT EXISTS projects (
  city_id                TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  external_id            TEXT NOT NULL,
  name                   TEXT NOT NULL,
  address                TEXT,
  borough                TEXT,                       -- generic "borough/district"
  neighborhood           TEXT,
  postcode               TEXT,
  council_district       TEXT,
  community_board        TEXT,
  construction_type      TEXT,
  extended_affordability BOOLEAN NOT NULL DEFAULT FALSE,
  prevailing_wage        BOOLEAN NOT NULL DEFAULT FALSE,
  start_date             DATE,
  completion_date        DATE,
  geom                   GEOGRAPHY(POINT, 4326) NOT NULL,
  -- unit counts
  units_total            INT NOT NULL DEFAULT 0,
  units_counted          INT NOT NULL DEFAULT 0,
  units_rental           INT NOT NULL DEFAULT 0,
  units_homeownership    INT NOT NULL DEFAULT 0,
  -- income tiers
  units_extremely_low    INT NOT NULL DEFAULT 0,
  units_very_low         INT NOT NULL DEFAULT 0,
  units_low              INT NOT NULL DEFAULT 0,
  units_moderate         INT NOT NULL DEFAULT 0,
  units_middle           INT NOT NULL DEFAULT 0,
  units_other_income     INT NOT NULL DEFAULT 0,
  -- bedroom mix
  units_studio           INT NOT NULL DEFAULT 0,
  units_1br              INT NOT NULL DEFAULT 0,
  units_2br              INT NOT NULL DEFAULT 0,
  units_3br              INT NOT NULL DEFAULT 0,
  units_4plus_br         INT NOT NULL DEFAULT 0,
  -- meta
  buildings_count        INT NOT NULL DEFAULT 1,
  raw                    JSONB,
  imported_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (city_id, external_id)
);

CREATE INDEX IF NOT EXISTS projects_geom_idx  ON projects USING GIST (geom);
CREATE INDEX IF NOT EXISTS projects_city_idx  ON projects (city_id);
CREATE INDEX IF NOT EXISTS projects_borough_idx ON projects (borough);
CREATE INDEX IF NOT EXISTS projects_year_idx  ON projects ((EXTRACT(YEAR FROM start_date)::int));
CREATE INDEX IF NOT EXISTS projects_total_idx ON projects (units_total);

-- Census tracts with ACS-derived demographics. Keyed by the 11-digit
-- GEOID (state(2)+county(3)+tract(6)). Geom is multipolygon because
-- coastal tracts can be discontinuous over water.
CREATE TABLE IF NOT EXISTS census_tracts (
  geoid                  TEXT PRIMARY KEY,
  city_id                TEXT REFERENCES cities(id) ON DELETE SET NULL,
  state_fips             TEXT NOT NULL,
  county_fips            TEXT NOT NULL,
  tract_fips             TEXT NOT NULL,
  name                   TEXT,
  population             INT,
  median_income          INT,             -- median household income in USD
  renter_households      INT,             -- denominator for burden calcs
  rent_burdened          INT,             -- households paying 30%+ of income on rent
  severely_rent_burdened INT,             -- households paying 50%+
  geom                   GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  imported_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS census_tracts_geom_idx ON census_tracts USING GIST (geom);
CREATE INDEX IF NOT EXISTS census_tracts_city_idx ON census_tracts (city_id);

-- Elected representatives mapped to projects via district numbers. NYC
-- has 1..51 council districts, SF has 1..11 supervisor districts. The
-- `district` column is text so it works for any future city's id scheme.
CREATE TABLE IF NOT EXISTS council_members (
  city_id     TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  district    TEXT NOT NULL,
  name        TEXT NOT NULL,
  party       TEXT,
  website_url TEXT,
  email       TEXT,
  phone       TEXT,
  photo_url   TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (city_id, district)
);
CREATE INDEX IF NOT EXISTS council_members_city_idx ON council_members (city_id);

-- City metadata seed. Re-run is harmless thanks to ON CONFLICT DO UPDATE.
INSERT INTO cities (id, name, center_lat, center_lng, default_zoom, data_source, data_source_url)
VALUES
  (
    'nyc',
    'New York City',
    40.7484,
    -73.9857,
    11,
    'NYC HPD Affordable Housing Production by Building',
    'https://data.cityofnewyork.us/dataset/Affordable-Housing-Production-by-Building/hg8x-zxpr'
  ),
  (
    'sfo',
    'San Francisco',
    37.7749,
    -122.4194,
    12,
    'MOHCD Affordable Housing Pipeline',
    'https://data.sfgov.org/Housing-and-Buildings/Mayor-s-Office-of-Housing-and-Community-Developmen/aaxw-2cb8'
  ),
  (
    'chi',
    'Chicago',
    41.8781,
    -87.6298,
    11,
    'Chicago Affordable Rental Housing Developments',
    'https://data.cityofchicago.org/Community-Economic-Development/Affordable-Rental-Housing-Developments/s6ha-ppgi'
  ),
  (
    'lax',
    'Los Angeles',
    34.0522,
    -118.2437,
    10,
    'LAHD Affordable Housing Projects (2003 to present)',
    'https://data.lacity.org/Housing-and-Real-Estate/LAHD-Affordable-Housing-Projects-List-2003-to-Pres/mymu-zi3s'
  ),
  (
    'dc',
    'Washington DC',
    38.9072,
    -77.0369,
    12,
    'DC Affordable Housing (DHCD / DCGIS)',
    'https://opendata.dc.gov/datasets/DCGIS::affordable-housing'
  ),
  (
    'phl',
    'Philadelphia',
    39.9526,
    -75.1652,
    12,
    'Phila Division of Housing & Community Development',
    'https://www.opendataphilly.org/dataset/affordable-housing-production'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  default_zoom = EXCLUDED.default_zoom,
  data_source = EXCLUDED.data_source,
  data_source_url = EXCLUDED.data_source_url;
