# groundwork

Interactive map of every affordable-housing project in six U.S. cities — New York, San Francisco, Los Angeles, Washington DC, Chicago, and Philadelphia. ~6,500 projects pulled from each city's open-data portal, normalized into one Postgres + PostGIS schema, and rendered on a single page where you can switch between cities, compare them side by side, see census-tract rent-burden as a choropleth, drill into the worst-served neighborhoods, surface the elected council member for any project, and chart production over time by income tier.

Built as a portfolio piece around the question: what does it actually take to compare housing policy across cities when every city publishes its data differently?

## What you can do on the page

- **Map every project** in the active city (HPD pipeline in NYC, MOHCD in SF, HCID/LA, DC's affordable housing inventory, Chicago's affordable rental inventory, Phila's affordable housing production). Marker radius scales with unit count; clusters at city-wide zoom.
- **Filter** by free-text search, borough/area, construction type (new vs preservation), start year, and project size. Results update the map and the list together.
- **Click any marker** to see a detail panel with unit totals, AMI breakdown, bedroom mix, council district + the elected representative scraped from public sources, community board, an "open in Google Maps" link, and a one-click email link.
- **Switch cities** in the sidebar. URL state syncs so links share.
- **Compare cities side by side** — a panel that stacks per-city headline numbers for unit totals, income tier breakdown, construction type split, and date range.
- **Rent burden choropleth** — toggleable layer showing what percentage of renter households in each census tract are paying >30% of income on rent, from ACS 2022 5-year.
- **Supply–demand gap analysis** — a PostGIS spatial join that, for every tract, counts rent-burdened households against affordable units within 1 km. Returns the worst-served tracts as a clickable list with sparkline bars.
- **Production trends** — a stacked bar chart of units produced per year, broken down by income tier (Extremely Low → Middle Income → Other). Works on the five cities whose datasets include a project start or completion date; Chicago's feed has neither.

## Stack

- **Frontend.** Next.js 16 + React 19, App Router. MapLibre GL for the map (no API key — Carto basemap CDN is free). Tailwind v4. Charts are hand-written SVG so no chart-library bundle.
- **Backend.** Postgres + PostGIS on Supabase, queried directly from Next.js route handlers. The interesting queries are pure SQL — the gap analysis does its spatial join entirely in Postgres rather than shuttling rows through Node.
- **ETL.** One loader script per city under `scripts/`. Each maps its city's API (Socrata, ArcGIS, plain CSV — they're all different) onto a shared `Project` schema. Re-runnable, upserts on `(city_id, external_id)`.
- **Census.** `scripts/load-census.mjs` pulls TIGERweb tract polygons and ACS 5-year tables for population, median income, renter households, and rent-burden counts.
- **Stakeholders.** `scripts/load-council.mjs` scrapes council/supervisor rosters from the city's own site or Wikipedia, depending on what's reachable.

## Routes

| Route | What it returns |
| --- | --- |
| `/api/cities` | All loaded cities + per-city headline stats. |
| `/api/projects?city=…` | Every project for that city, lat/lng inlined. |
| `/api/tracts?city=…` | GeoJSON of tract polygons + rent-burden percentages, for the choropleth. |
| `/api/gap?city=…&radius=1000&limit=25` | Worst-served tracts, ordered by (burdened households / nearby affordable units). |
| `/api/stakeholders?city=…&district=…` | The elected representative for that district. |
| `/api/trends?city=…` | Units per year, broken down by income tier and construction type. |

## Run locally

You need a Postgres database with PostGIS. The free Supabase tier works; so does a local container:

```bash
docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgis/postgis:16-3.4
cp .env.example .env.local
# fill in DATABASE_URL, and CENSUS_API_KEY if you want to re-load census data
```

```bash
git clone https://github.com/c-tonneslan/groundwork
cd groundwork
npm install

# one-time setup
node scripts/migrate.mjs

# load any subset of cities (each takes 30-90s):
node scripts/load-pg.mjs        # NYC, the original loader
node scripts/load-sfo.mjs
node scripts/load-la.mjs
node scripts/load-dc.mjs
node scripts/load-chi.mjs
node scripts/load-phl.mjs

# census + council are optional but the burden/gap/stakeholders panels need them
node scripts/load-census.mjs
node scripts/load-council.mjs

npm run dev
# open http://localhost:3000
```

Without a database the app falls back to a static `nyc-housing.json` snapshot so it still demos. The multi-city, burden, gap, stakeholders, and trends features all require Postgres.

## Adding another city

1. Write `scripts/load-{city}.mjs`. Use one of the existing loaders as a template — `load-phl.mjs` for ArcGIS feature services, `load-pg.mjs` for Socrata, `load-la.mjs` for a hybrid. Map the source's schema onto the `projects` table; missing columns just stay null and the UI handles it.
2. Add a row to the `cities` table with id, name, center lat/lng, default zoom.
3. The frontend picks it up automatically via `/api/cities`.

## Known data caveats

- **Date coverage is uneven.** NYC and SF carry start dates; DC and Philly only carry completion dates; LA carries both; Chicago carries neither. The trends view uses `COALESCE(start_date, completion_date)` and falls back to "no temporal data" for Chicago.
- **Council districts.** NYC carries them on the record. The other cities either don't, or split projects across many points without a clean cross-reference. So the stakeholders panel is most accurate in NYC and slightly speculative elsewhere.
- **Income tier categories** aren't strictly comparable across cities — each city defines "Extremely Low" against its own AMI. The trends view groups them as ELI / VLI / LI / Mod / Mid / Other so cross-city comparison is directional, not exact.

## Future

- Affordability expiration analysis — most LIHTC projects have 30-year affordability periods. Surface which neighborhoods will lose the most affordable units in the next decade.
- Boston, Seattle, Austin loaders.
- CSV / GeoJSON export of any filtered view.
- URL state for the active filter set, not just the active city.

MIT. Built by [Charlie Tonneslan](https://c-tonneslan-portfolio.vercel.app/).
