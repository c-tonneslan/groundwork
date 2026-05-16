// GET /api/trends?city=nyc
//
// Aggregates each city's projects by year and income tier so the
// frontend can render a stacked bar chart of production over time.
// "Year" is COALESCE(start_date, completion_date) since the source
// datasets are split: NYC and SF carry start dates, DC and PHL only
// carry completion dates, LA carries both. Chicago has neither and
// will return an empty series.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

interface Row {
  year: number;
  projects: number;
  units_total: number;
  units_extremely_low: number;
  units_very_low: number;
  units_low: number;
  units_moderate: number;
  units_middle: number;
  units_other_income: number;
  new_construction: number;
  preservation: number;
}

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();

  const sql = `
    WITH dated AS (
      SELECT
        EXTRACT(YEAR FROM COALESCE(start_date, completion_date))::int AS year,
        units_total,
        units_extremely_low,
        units_very_low,
        units_low,
        units_moderate,
        units_middle,
        units_other_income,
        construction_type
      FROM projects
      WHERE city_id = $1
        AND COALESCE(start_date, completion_date) IS NOT NULL
    )
    SELECT
      year,
      COUNT(*)::int                                                          AS projects,
      SUM(units_total)::int                                                  AS units_total,
      SUM(units_extremely_low)::int                                          AS units_extremely_low,
      SUM(units_very_low)::int                                               AS units_very_low,
      SUM(units_low)::int                                                    AS units_low,
      SUM(units_moderate)::int                                               AS units_moderate,
      SUM(units_middle)::int                                                 AS units_middle,
      SUM(units_other_income)::int                                           AS units_other_income,
      SUM(CASE WHEN construction_type = 'New Construction' THEN 1 ELSE 0 END)::int AS new_construction,
      SUM(CASE WHEN construction_type = 'Preservation'     THEN 1 ELSE 0 END)::int AS preservation
    FROM dated
    WHERE year IS NOT NULL
    GROUP BY year
    ORDER BY year ASC;
  `;

  try {
    const res = await db.query<Row>(sql, [cityId]);
    const years = res.rows.map((r) => ({
      year: r.year,
      projects: r.projects,
      units: {
        total: r.units_total,
        extremelyLow: r.units_extremely_low,
        veryLow: r.units_very_low,
        low: r.units_low,
        moderate: r.units_moderate,
        middle: r.units_middle,
        other: r.units_other_income,
      },
      construction: {
        newConstruction: r.new_construction,
        preservation: r.preservation,
      },
    }));
    return NextResponse.json({ city: cityId, years });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
