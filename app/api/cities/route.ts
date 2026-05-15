// GET /api/cities
// Returns metadata + per-city headline stats so the sidebar can render
// a switcher with counts and the comparison panel can render side-by-side
// summaries without per-city round-trips.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

interface CityRow {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  default_zoom: number;
  data_source: string | null;
  data_source_url: string | null;
  fetched_at: Date | null;
}

interface StatsRow {
  city_id: string;
  project_count: number;
  unit_total: number | null;
  unit_extremely_low: number | null;
  unit_very_low: number | null;
  unit_low: number | null;
  unit_moderate: number | null;
  unit_middle: number | null;
  unit_other_income: number | null;
  earliest_start: Date | null;
  latest_start: Date | null;
  new_construction: number;
  preservation: number;
}

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const [cityRes, statsRes] = await Promise.all([
      db.query<CityRow>(
        "SELECT id, name, center_lat, center_lng, default_zoom, data_source, data_source_url, fetched_at FROM cities ORDER BY name",
      ),
      db.query<StatsRow>(`
        SELECT
          city_id,
          COUNT(*)::int                          AS project_count,
          SUM(units_total)::bigint               AS unit_total,
          SUM(units_extremely_low)::bigint       AS unit_extremely_low,
          SUM(units_very_low)::bigint            AS unit_very_low,
          SUM(units_low)::bigint                 AS unit_low,
          SUM(units_moderate)::bigint            AS unit_moderate,
          SUM(units_middle)::bigint              AS unit_middle,
          SUM(units_other_income)::bigint        AS unit_other_income,
          MIN(start_date)                        AS earliest_start,
          MAX(start_date)                        AS latest_start,
          SUM(CASE WHEN construction_type = 'New Construction' THEN 1 ELSE 0 END)::int AS new_construction,
          SUM(CASE WHEN construction_type = 'Preservation'     THEN 1 ELSE 0 END)::int AS preservation
        FROM projects
        GROUP BY city_id
      `),
    ]);

    const statsByCity = new Map<string, StatsRow>();
    for (const s of statsRes.rows) statsByCity.set(s.city_id, s);

    const cities = cityRes.rows.map((c) => {
      const s = statsByCity.get(c.id);
      return {
        id: c.id,
        name: c.name,
        center: [c.center_lat, c.center_lng] as [number, number],
        defaultZoom: c.default_zoom,
        dataSource: c.data_source,
        dataSourceUrl: c.data_source_url,
        fetchedAt: c.fetched_at ? c.fetched_at.toISOString() : null,
        stats: s
          ? {
              projects: s.project_count,
              units: {
                total: Number(s.unit_total ?? 0),
                extremelyLow: Number(s.unit_extremely_low ?? 0),
                veryLow: Number(s.unit_very_low ?? 0),
                low: Number(s.unit_low ?? 0),
                moderate: Number(s.unit_moderate ?? 0),
                middle: Number(s.unit_middle ?? 0),
                other: Number(s.unit_other_income ?? 0),
              },
              construction: {
                newConstruction: s.new_construction ?? 0,
                preservation: s.preservation ?? 0,
              },
              earliestStart: s.earliest_start ? s.earliest_start.toISOString().slice(0, 10) : null,
              latestStart: s.latest_start ? s.latest_start.toISOString().slice(0, 10) : null,
            }
          : null,
      };
    });

    return NextResponse.json({ cities });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
