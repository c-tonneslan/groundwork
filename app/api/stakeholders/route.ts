// GET /api/stakeholders?city=nyc&district=8&exclude=<projectId>
//
// For a given city + council/supervisor district, returns:
//   - The elected representative (council_members row)
//   - District-wide totals (projects + units in pipeline)
//   - Up to 5 sibling projects in the same district (excluding the
//     currently-selected one)
//
// This is the Phase 4 "who's behind it" view: clicking a project
// surfaces the human accountable to that district, plus the rest of
// what they're stewarding.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();
  const district = (url.searchParams.get("district") ?? "").trim();
  const exclude = url.searchParams.get("exclude") ?? "";

  if (!district) {
    return NextResponse.json({ error: "district is required" }, { status: 400 });
  }

  try {
    const memberQ = db.query(
      `SELECT district, name, party, website_url, email, phone, photo_url
       FROM council_members WHERE city_id = $1 AND district = $2 LIMIT 1`,
      [cityId, district],
    );

    const summaryQ = db.query(
      `SELECT
         COUNT(*)::int                       AS project_count,
         COALESCE(SUM(units_total), 0)::int  AS unit_total
       FROM projects
       WHERE city_id = $1 AND council_district = $2`,
      [cityId, district],
    );

    const siblingsQ = db.query(
      `SELECT
         external_id, name, address, borough, neighborhood,
         units_total, construction_type, start_date,
         ST_Y(geom::geometry) AS lat,
         ST_X(geom::geometry) AS lng
       FROM projects
       WHERE city_id = $1
         AND council_district = $2
         AND ($3 = '' OR external_id <> $3)
       ORDER BY units_total DESC NULLS LAST
       LIMIT 5`,
      [cityId, district, exclude],
    );

    const [member, summary, siblings] = await Promise.all([memberQ, summaryQ, siblingsQ]);

    const m = member.rows[0];
    const s = summary.rows[0];

    return NextResponse.json({
      city: cityId,
      district,
      representative: m
        ? {
            district: m.district,
            name: m.name,
            party: m.party,
            websiteUrl: m.website_url,
            email: m.email,
            phone: m.phone,
            photoUrl: m.photo_url,
          }
        : null,
      summary: {
        projectCount: s?.project_count ?? 0,
        unitTotal: s?.unit_total ?? 0,
      },
      siblings: siblings.rows.map((r) => ({
        id: String(r.external_id),
        name: r.name,
        address: r.address,
        borough: r.borough,
        neighborhood: r.neighborhood,
        unitsTotal: Number(r.units_total ?? 0),
        constructionType: r.construction_type,
        startDate: r.start_date instanceof Date
          ? r.start_date.toISOString().slice(0, 10)
          : r.start_date,
        lat: Number(r.lat),
        lng: Number(r.lng),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
