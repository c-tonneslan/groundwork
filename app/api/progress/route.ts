// GET /api/progress?city=nyc
//
// Joins each city's published housing-production target (see
// lib/targets.ts) with the cumulative units actually delivered per
// year in the open dataset, so the frontend can chart promise vs
// delivery on one axis.
//
// "Per year" uses whichever of start_date or completion_date is set,
// matching the trends endpoint. Most plans count financings or starts;
// where a city's dataset only has completions, that's noted in the
// target's `notes` field and shown to the user.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";
import { targetForCity } from "@/lib/targets";

export const runtime = "nodejs";

interface YearRow {
  year: number;
  units: number;
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

  const target = targetForCity(cityId);
  if (!target) {
    return NextResponse.json({
      cityId,
      target: null,
      cumulative: [],
      note: "No published housing-production target on file for this city.",
    });
  }

  const sql = `
    WITH dated AS (
      SELECT
        EXTRACT(YEAR FROM COALESCE(start_date, completion_date))::int AS year,
        units_total
      FROM projects
      WHERE city_id = $1
        AND COALESCE(start_date, completion_date) IS NOT NULL
    )
    SELECT year, SUM(units_total)::int AS units
    FROM dated
    WHERE year IS NOT NULL
      AND year >= $2
    GROUP BY year
    ORDER BY year ASC;
  `;

  try {
    const res = await db.query<YearRow>(sql, [cityId, target.baselineYear]);

    // Walk every year from baseline → target so the chart has a clean,
    // gap-free x-axis even when the dataset misses a year.
    const byYear = new Map<number, number>();
    for (const r of res.rows) byYear.set(r.year, r.units);

    const yearly: { year: number; units: number }[] = [];
    let runningTotal = 0;
    const cumulative: {
      year: number;
      units: number;
      cumulative: number;
      targetCumulative: number;
    }[] = [];
    const yearsTotal = target.targetYear - target.baselineYear;
    const perYearTarget = target.targetUnits / Math.max(yearsTotal, 1);

    for (let y = target.baselineYear; y <= target.targetYear; y++) {
      const u = byYear.get(y) ?? 0;
      runningTotal += u;
      yearly.push({ year: y, units: u });
      cumulative.push({
        year: y,
        units: u,
        cumulative: runningTotal,
        targetCumulative: Math.round(perYearTarget * (y - target.baselineYear + 1)),
      });
    }

    // Find the last year with actual data so the frontend can render
    // "as of YEAR, you are at X% of target" honestly.
    const lastDataYear =
      res.rows.length > 0 ? res.rows[res.rows.length - 1].year : target.baselineYear;
    const lastEntry =
      cumulative.find((c) => c.year === lastDataYear) ??
      cumulative[cumulative.length - 1];

    return NextResponse.json({
      cityId,
      target,
      cumulative,
      yearly,
      lastDataYear,
      progress: {
        delivered: lastEntry?.cumulative ?? 0,
        expectedByNow: lastEntry?.targetCumulative ?? 0,
        pctOfFinalTarget: lastEntry
          ? Math.round((lastEntry.cumulative / target.targetUnits) * 1000) / 10
          : 0,
        pctOfExpected: lastEntry && lastEntry.targetCumulative > 0
          ? Math.round((lastEntry.cumulative / lastEntry.targetCumulative) * 1000) / 10
          : 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
