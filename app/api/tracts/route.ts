// GET /api/tracts?city=nyc
//
// Returns the GeoJSON FeatureCollection of census tracts for one city
// plus the derived burden metrics that drive choropleth coloring on
// the frontend. Cached aggressively because tract geometry doesn't move.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();

  // We let PostGIS build the GeoJSON. This is much faster than fetching
  // raw geom rows and json-encoding in Node, and the output is exactly
  // the shape Leaflet's L.geoJSON layer expects.
  const sql = `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(features.feature), '[]'::json)
    )::text AS geojson
    FROM (
      SELECT json_build_object(
        'type', 'Feature',
        'id',   t.geoid,
        'geometry', ST_AsGeoJSON(t.geom::geometry, 6)::json,
        'properties', json_build_object(
          'geoid',                  t.geoid,
          'name',                   t.name,
          'population',             t.population,
          'medianIncome',           t.median_income,
          'renterHouseholds',       t.renter_households,
          'rentBurdened',           t.rent_burdened,
          'severelyRentBurdened',   t.severely_rent_burdened,
          'rentBurdenedPct', CASE
            WHEN COALESCE(t.renter_households, 0) > 0
              THEN ROUND(t.rent_burdened::numeric * 100 / t.renter_households, 1)
            ELSE NULL
          END,
          'severelyBurdenedPct', CASE
            WHEN COALESCE(t.renter_households, 0) > 0
              THEN ROUND(t.severely_rent_burdened::numeric * 100 / t.renter_households, 1)
            ELSE NULL
          END
        )
      ) AS feature
      FROM census_tracts t
      WHERE t.city_id = $1
    ) features;
  `;

  try {
    const res = await db.query<{ geojson: string }>(sql, [cityId]);
    const body = res.rows[0]?.geojson ?? '{"type":"FeatureCollection","features":[]}';
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Tract geometry doesn't change between ACS releases, so cache
        // aggressively at the CDN.
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
