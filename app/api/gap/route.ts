// GET /api/gap?city=nyc&radius=1000&limit=25
//
// The analytical heart of Phase 3. For every census tract in the city,
// compute a "supply-demand gap" combining:
//   - DEMAND: # rent-burdened households in the tract
//   - SUPPLY: total affordable units in HPD/MOHCD projects within
//             `radius` meters of the tract's centroid (default 1 km)
//
// Returns the worst-served tracts (highest demand, lowest local supply)
// so the frontend can render an "underserved neighborhoods" list. Pure
// SQL via PostGIS spatial joins — no per-row Node logic.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();
  const radius = Math.max(
    100,
    Math.min(parseInt(url.searchParams.get("radius") ?? "1000", 10) || 1000, 5000),
  );
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 100);

  const sql = `
    WITH supply AS (
      SELECT
        t.geoid,
        COALESCE(SUM(p.units_total), 0)::int AS nearby_units,
        COUNT(p.*)::int                       AS nearby_projects
      FROM census_tracts t
      LEFT JOIN projects p
        ON p.city_id = t.city_id
       AND ST_DWithin(p.geom, ST_Centroid(t.geom::geometry)::geography, $2)
      WHERE t.city_id = $1
      GROUP BY t.geoid
    )
    SELECT
      t.geoid,
      t.name,
      t.population,
      t.median_income,
      t.renter_households,
      t.rent_burdened,
      t.severely_rent_burdened,
      CASE WHEN COALESCE(t.renter_households, 0) > 0
        THEN ROUND(t.rent_burdened::numeric * 100 / t.renter_households, 1)
        ELSE NULL END AS rent_burdened_pct,
      s.nearby_units,
      s.nearby_projects,
      -- gap = burdened households per 1 affordable unit in radius.
      -- High value = many households, few nearby units = underserved.
      CASE WHEN s.nearby_units > 0
        THEN ROUND(t.rent_burdened::numeric / s.nearby_units, 2)
        ELSE NULL END AS households_per_unit,
      ST_Y(ST_Centroid(t.geom::geometry)) AS center_lat,
      ST_X(ST_Centroid(t.geom::geometry)) AS center_lng
    FROM census_tracts t
    JOIN supply s ON s.geoid = t.geoid
    WHERE t.rent_burdened IS NOT NULL
      AND t.renter_households > 100
    ORDER BY
      -- Worst-served first: many burdened households AND few units.
      (t.rent_burdened::numeric * 1.0 / GREATEST(s.nearby_units + 1, 1)) DESC
    LIMIT $3;
  `;

  try {
    const res = await db.query(sql, [cityId, radius, limit]);
    const tracts = res.rows.map((r) => ({
      geoid: r.geoid,
      name: r.name,
      population: r.population,
      medianIncome: r.median_income,
      renterHouseholds: r.renter_households,
      rentBurdened: r.rent_burdened,
      severelyRentBurdened: r.severely_rent_burdened,
      rentBurdenedPct: r.rent_burdened_pct == null ? null : Number(r.rent_burdened_pct),
      nearbyUnits: r.nearby_units,
      nearbyProjects: r.nearby_projects,
      householdsPerUnit:
        r.households_per_unit == null ? null : Number(r.households_per_unit),
      centerLat: Number(r.center_lat),
      centerLng: Number(r.center_lng),
    }));
    return NextResponse.json({
      city: cityId,
      radiusMeters: radius,
      tracts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
