# groundwork data layer

Postgres + PostGIS backs every map query.

## Schema

`schema.sql` defines two tables:

- `cities` — one row per supported city (id, name, default map center).
- `projects` — one row per civic project, keyed by `(city_id, external_id)`. The geographic position lives in a `GEOGRAPHY(POINT, 4326)` column with a GIST index, so bbox lookups stay fast as more cities land in the same table.

The schema is intentionally generic across project types. Today every row is an HPD affordable-housing project; adding capital projects, permits, or transit work just means a new fetch script writing to the same table (with a different `external_id` namespace).

## One-time setup

1. Create a Supabase project (free tier, ~30 sec). Postgres + PostGIS come pre-installed.
2. Settings → Database → Connection string → **URI**. Copy.
3. Locally:
   ```bash
   cp .env.example .env.local
   # paste your URI as DATABASE_URL
   node scripts/load-pg.mjs
   ```
   The loader applies `db/schema.sql`, fetches NYC's HPD dataset, aggregates 8,983 building rows into ~3,700 projects, and upserts. Re-runs are idempotent.
4. On Vercel: project Settings → Environment Variables → add `DATABASE_URL`. Redeploy.

## API surface

```
GET /api/projects
  ?city=nyc                    (default 'nyc')
  ?bbox=minLng,minLat,maxLng,maxLat
  ?borough=Brooklyn
  ?type=New%20Construction
  ?q=archer                    (text search across name/address/neighborhood)
  ?min=100                     (units_total >= 100)
  ?year=2024                   (start_date year >= 2024)
  ?limit=4000                  (cap, max 10000)
```

bbox filtering is a real PostGIS `ST_Intersects` against the GIST-indexed `geom` column, which is the whole point of having a spatial DB rather than a JSON file. At wide zooms the frontend sends a small bbox and gets back only the visible projects.

## Adding a second city

1. Add a row to `cities` (or just include it in the seed at the bottom of `schema.sql`).
2. Write `scripts/load-<cityId>.mjs` that maps that city's open-data API to the same column set. Use the NYC loader as a template.
3. Run it. The schema is identical, so the frontend's existing filters and queries just work with `?city=<id>`.
