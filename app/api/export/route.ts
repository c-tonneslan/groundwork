// GET /api/export
//
// Same filter params as /api/projects, but returns the filtered set as
// either a CSV file or a GeoJSON FeatureCollection. Intended for the
// "download this view" button in the sidebar, and for anyone who'd
// rather pull a snapshot than scrape /api/projects.
//
// Query params:
//   city     city id, default 'nyc'
//   format   'csv' (default) or 'geojson'
//   borough, type, q, min, year, bbox  same as /api/projects
//   limit    default 10000, capped at 50000 because exports usually
//            want the whole filtered set, not a paged slice
//
// CSV columns mirror the SQL select list; one row per project. GeoJSON
// emits Point features with the same fields as `properties`.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

const COLUMNS = [
  "city_id",
  "external_id",
  "name",
  "address",
  "borough",
  "neighborhood",
  "postcode",
  "council_district",
  "community_board",
  "construction_type",
  "extended_affordability",
  "prevailing_wage",
  "start_date",
  "completion_date",
  "lat",
  "lng",
  "units_total",
  "units_counted",
  "units_rental",
  "units_homeownership",
  "units_extremely_low",
  "units_very_low",
  "units_low",
  "units_moderate",
  "units_middle",
  "units_other_income",
  "units_studio",
  "units_1br",
  "units_2br",
  "units_3br",
  "units_4plus_br",
  "buildings_count",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  // RFC 4180: wrap in quotes if the field contains a comma, quote, or
  // newline. Escape embedded quotes by doubling them.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function safeFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function GET(req: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured on the server. See README.md for setup." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const cityId = (url.searchParams.get("city") ?? "nyc").toLowerCase();
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "geojson") {
    return NextResponse.json(
      { error: "format must be 'csv' or 'geojson'" },
      { status: 400 },
    );
  }

  const bbox = url.searchParams.get("bbox");
  const borough = url.searchParams.get("borough") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  const min = parseInt(url.searchParams.get("min") ?? "0", 10) || 0;
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10000", 10) || 10000, 50000);

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
      p.city_id, p.external_id, p.name, p.address, p.borough, p.neighborhood,
      p.postcode, p.council_district, p.community_board, p.construction_type,
      p.extended_affordability, p.prevailing_wage, p.start_date, p.completion_date,
      ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
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

  let rows: Record<string, unknown>[];
  try {
    const res = await db.query(sql, params);
    rows = res.rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown db error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `groundwork-${safeFilename(cityId)}-${stamp}`;

  if (format === "csv") {
    const header = COLUMNS.join(",");
    const lines = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","));
    const body = [header, ...lines].join("\n") + "\n";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  // GeoJSON: skip rows without coordinates, since they can't be points.
  const features = rows
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
    .map((r) => {
      const props: Record<string, unknown> = {};
      for (const c of COLUMNS) {
        if (c === "lat" || c === "lng") continue;
        const v = r[c];
        props[c] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
      }
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(r.lng), Number(r.lat)],
        },
        properties: props,
      };
    });

  const fc = { type: "FeatureCollection" as const, features };
  return new Response(JSON.stringify(fc), {
    status: 200,
    headers: {
      "content-type": "application/geo+json",
      "content-disposition": `attachment; filename="${base}.geojson"`,
    },
  });
}
