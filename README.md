# groundwork

Interactive map of every affordable-housing project in New York City's HPD pipeline. Filter by borough, construction type, and unit count, click a marker for the income-tier breakdown, bedroom mix, council district, and a contact link for HPD. 3,707 projects, real data, no demo placeholders.

Built as a portfolio piece exploring civic open data and geospatial UI. Single city for now; the data model and routing are written so swapping in Philly, SF, or Boston is a fetch script and a switch, not a rewrite.

## What's on the map

- **One marker per project**, aggregated from 8,983 building-level rows in [NYC's "Affordable Housing Production by Building"](https://data.cityofnewyork.us/dataset/Affordable-Housing-Production-by-Building/hg8x-zxpr) dataset. Centroid of all the project's buildings; marker radius scales with total unit count.
- **Marker clusters** at city-wide zoom (MapLibre's built-in clustering). Click a cluster to zoom in.
- **Click any marker** to open the detail panel: total units, counted units, income-tier breakdown (Extremely Low → Middle Income), bedroom mix, council district, community board, extended-affordability flag, prevailing-wage flag. One-click open in Google Maps, one-click mailto: HPD.

## Filtering

The sidebar narrows the map and the list together:

- Free-text search across project name, address, neighborhood, postcode
- Borough dropdown
- Construction type (New Construction, Preservation)
- Start year ("2024 or later", etc)
- Minimum project size ("100+ units" etc)

Active filters get a green outline, and a "clear filters" link appears.

## Stack

- Next.js 16 + React 19, App Router, fully client-rendered after first paint
- MapLibre GL JS for the map (no API key — Carto basemap CDN is free)
- Tailwind CSS v4
- A Node script (`scripts/fetch-nyc.mjs`) pulls the live Socrata API, aggregates buildings to projects, and writes `public/nyc-housing.json` (~2 MB). Re-run any time:

```bash
node scripts/fetch-nyc.mjs
```

Lat/lng for each project is the centroid of its building lat/lngs. Unit counts and bedroom mixes are summed across buildings.

## Run locally

```bash
git clone https://github.com/c-tonneslan/groundwork
cd groundwork
npm install
node scripts/fetch-nyc.mjs
npm run dev
# open http://localhost:3000
```

## Adding another city

Nothing about the frontend hardcodes NYC except the initial map center. To plug in Philadelphia or SF:

1. Write `scripts/fetch-{city}.mjs` that maps that city's open-data API onto the `Project` shape in `lib/types.ts`.
2. Output to `public/{city}-housing.json`.
3. Add a city switcher and fetch the matching JSON.

Same data shape, same map, same filters. No backend.

## Future

- Multi-city
- Capital construction projects + permits, not just housing
- Save filter combos to the URL
- "Adopt a project" prototype where orgs claim a listing and add events / volunteer slots
- Server-side PostGIS once the dataset crosses 500K rows

MIT. Built by [Charlie Tonneslan](https://c-tonneslan-portfolio.vercel.app/).
