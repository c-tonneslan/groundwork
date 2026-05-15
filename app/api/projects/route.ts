// GET /api/projects
//
// Query params (all optional):
//   city      city id, default 'nyc'
//   bbox      'minLng,minLat,maxLng,maxLat' for viewport-bound queries
//   borough   exact borough name match
//   type      exact construction type match
//   q         free-text search over name/address/neighborhood/postcode
//   min       minimum unit count
//   year      include only projects whose start_date year >= this
//   limit     default 4000
//
// Returns:
//   { city: { id, name, center, defaultZoom, fetchedAt }, projects: [...] }
//
// All filtering happens server-side via PostGIS / SQL. The frontend
// switches view modes (bbox-only vs full city) by changing which params
// it passes. Future multi-city support is just "?city=phl" etc.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

interface City {
  id: string;
  name: string;
  center: [number, number];
  defaultZoom: number;
  fetchedAt: string | null;
}

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL is not configured on the server. See README.md for setup.",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();
  const bbox = url.searchParams.get("bbox");
  const borough = url.searchParams.get("borough") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  const min = parseInt(url.searchParams.get("min") ?? "0", 10) || 0;
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "4000", 10) || 4000, 10000);

  const where: string[] = ["p.city_id = $1"];
  const params: unknown[] = [cityId];
  let i = 2;

  if (bbox) {
    const parts = bbox.split(",").map((n) => parseFloat(n));
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      where.push(
        `ST_Intersects(p.geom, ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)::geography)`,
      );
      params.push(parts[0], parts[1], parts[2], parts[3]);
      i += 4;
    }
  }
  if (borough) {
    where.push(`p.borough = $${i++}`);
    params.push(borough);
  }
  if (type) {
    where.push(`p.construction_type = $${i++}`);
    params.push(type);
  }
  if (q) {
    where.push(
      `(p.name ILIKE $${i} OR p.address ILIKE $${i} OR p.neighborhood ILIKE $${i} OR p.postcode ILIKE $${i})`,
    );
    params.push(`%${q}%`);
    i += 1;
  }
  if (min > 0) {
    where.push(`p.units_total >= $${i++}`);
    params.push(min);
  }
  if (year) {
    where.push(`EXTRACT(YEAR FROM p.start_date)::int >= $${i++}`);
    params.push(year);
  }

  params.push(limit);

  const sql = `
    SELECT
      p.city_id,
      p.external_id,
      p.name,
      p.address,
      p.borough,
      p.neighborhood,
      p.postcode,
      p.council_district,
      p.community_board,
      p.construction_type,
      p.extended_affordability,
      p.prevailing_wage,
      p.start_date,
      p.completion_date,
      ST_Y(p.geom::geometry) AS lat,
      ST_X(p.geom::geometry) AS lng,
      p.units_total, p.units_counted, p.units_rental, p.units_homeownership,
      p.units_extremely_low, p.units_very_low, p.units_low, p.units_moderate,
      p.units_middle, p.units_other_income,
      p.units_studio, p.units_1br, p.units_2br, p.units_3br, p.units_4plus_br,
      p.buildings_count
    FROM projects p
    WHERE ${where.join(" AND ")}
    ORDER BY p.units_total DESC NULLS LAST
    LIMIT $${i};
  `;

  try {
    const [cityRow, projRows] = await Promise.all([
      db.query<{
        id: string;
        name: string;
        center_lat: number;
        center_lng: number;
        default_zoom: number;
        fetched_at: Date | null;
      }>(
        "SELECT id, name, center_lat, center_lng, default_zoom, fetched_at FROM cities WHERE id = $1",
        [cityId],
      ),
      db.query(sql, params),
    ]);

    if (cityRow.rowCount === 0) {
      return NextResponse.json({ error: `unknown city: ${cityId}` }, { status: 404 });
    }

    const cityData = cityRow.rows[0];
    const city: City = {
      id: cityData.id,
      name: cityData.name,
      center: [cityData.center_lat, cityData.center_lng],
      defaultZoom: cityData.default_zoom,
      fetchedAt: cityData.fetched_at ? cityData.fetched_at.toISOString() : null,
    };

    const projects = projRows.rows.map((r: Record<string, unknown>) => ({
      id: String(r.external_id),
      name: String(r.name ?? ""),
      startDate: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : (r.start_date as string | null),
      borough: r.borough as string | null,
      address: r.address as string | null,
      postcode: r.postcode as string | null,
      constructionType: r.construction_type as string | null,
      extendedAffordability: Boolean(r.extended_affordability),
      prevailingWage: Boolean(r.prevailing_wage),
      councilDistrict: r.council_district ? parseInt(r.council_district as string, 10) || null : null,
      communityBoard: r.community_board as string | null,
      neighborhood: r.neighborhood as string | null,
      buildings: Number(r.buildings_count ?? 1),
      lat: Number(r.lat),
      lng: Number(r.lng),
      units: {
        total: Number(r.units_total ?? 0),
        counted: Number(r.units_counted ?? 0),
        rental: Number(r.units_rental ?? 0),
        homeownership: Number(r.units_homeownership ?? 0),
        extremelyLowIncome: Number(r.units_extremely_low ?? 0),
        veryLowIncome: Number(r.units_very_low ?? 0),
        lowIncome: Number(r.units_low ?? 0),
        moderateIncome: Number(r.units_moderate ?? 0),
        middleIncome: Number(r.units_middle ?? 0),
        otherIncome: Number(r.units_other_income ?? 0),
        studio: Number(r.units_studio ?? 0),
        oneBR: Number(r.units_1br ?? 0),
        twoBR: Number(r.units_2br ?? 0),
        threeBR: Number(r.units_3br ?? 0),
        fourPlusBR: Number(r.units_4plus_br ?? 0),
      },
    }));

    return NextResponse.json({
      city,
      count: projects.length,
      projects,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
