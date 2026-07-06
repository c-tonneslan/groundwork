// GET /api/expiring
//
// Affordability-expiration analysis. Most LIHTC projects have a 30-year
// affordability period that begins at placement-in-service (completion).
// None of the city portals we load expose the legal end-of-affordability
// date directly, so we approximate it as:
//
//   COALESCE(completion_date, start_date) + 30 years
//
// Projects with no date at all (Chicago, parts of Philly) are excluded.
// The result is grouped by expiration year so the UI can show a "how
// many units roll off in the next decade" view.
//
// Query params:
//   city     city id, default 'nyc'
//   horizon  how many years forward to look, default 10, capped at 30
//
// Returns:
//   {
//     cityId, horizonYears, fromYear, throughYear,
//     totalUnits, projectCount,
//     years: [{ year, units, projects }],
//     topProjects: [{ id, name, borough, year, units }]
//   }

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

interface YearRow {
  year: number;
  units: string | number;
  projects: number;
}

interface ProjectRow {
  external_id: string;
  name: string;
  borough: string | null;
  units_total: number;
  expires_year: number;
}

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured on the server." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();
  const horizon = Math.min(
    Math.max(parseInt(url.searchParams.get("horizon") ?? "10", 10) || 10, 1),
    30,
  );

  const thisYear = new Date().getFullYear();
  const throughYear = thisYear + horizon;

  try {
    const [yearsRes, topRes, totalsRes] = await Promise.all([
      db.query<YearRow>(
        `
        SELECT
          EXTRACT(YEAR FROM (COALESCE(completion_date, start_date) + INTERVAL '30 years'))::int AS year,
          SUM(units_total)::bigint AS units,
          COUNT(*)::int AS projects
        FROM projects
        WHERE city_id = $1
          AND COALESCE(completion_date, start_date) IS NOT NULL
        GROUP BY year
        HAVING EXTRACT(YEAR FROM (COALESCE(completion_date, start_date) + INTERVAL '30 years')) BETWEEN $2 AND $3
        ORDER BY year ASC
        `,
        [cityId, thisYear, throughYear],
      ),
      db.query<ProjectRow>(
        `
        SELECT
          external_id,
          name,
          borough,
          units_total,
          EXTRACT(YEAR FROM (COALESCE(completion_date, start_date) + INTERVAL '30 years'))::int AS expires_year
        FROM projects
        WHERE city_id = $1
          AND COALESCE(completion_date, start_date) IS NOT NULL
          AND EXTRACT(YEAR FROM (COALESCE(completion_date, start_date) + INTERVAL '30 years')) BETWEEN $2 AND $3
        ORDER BY units_total DESC NULLS LAST, expires_year ASC, external_id ASC
        LIMIT 20
        `,
        [cityId, thisYear, throughYear],
      ),
      db.query<{ units: string | number; projects: number }>(
        `
        SELECT
          SUM(units_total)::bigint AS units,
          COUNT(*)::int AS projects
        FROM projects
        WHERE city_id = $1
          AND COALESCE(completion_date, start_date) IS NOT NULL
          AND EXTRACT(YEAR FROM (COALESCE(completion_date, start_date) + INTERVAL '30 years')) BETWEEN $2 AND $3
        `,
        [cityId, thisYear, throughYear],
      ),
    ]);

    const years = yearsRes.rows.map((r) => ({
      year: Number(r.year),
      units: Number(r.units ?? 0),
      projects: Number(r.projects ?? 0),
    }));

    const topProjects = topRes.rows.map((r) => ({
      id: r.external_id,
      name: r.name,
      borough: r.borough,
      year: Number(r.expires_year),
      units: Number(r.units_total ?? 0),
    }));

    const totals = totalsRes.rows[0];
    return NextResponse.json(
      {
        cityId,
        horizonYears: horizon,
        fromYear: thisYear,
        throughYear,
        totalUnits: Number(totals?.units ?? 0),
        projectCount: Number(totals?.projects ?? 0),
        years,
        topProjects,
      },
      {
        headers: {
          "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
