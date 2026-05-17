// Server-side fetch for a single project by (city_id, external_id).
// Used by /projects/[city]/[id]/page.tsx and its companion OG image.

import { db, hasDatabase } from "@/lib/db";

export interface ProjectRecord {
  cityId: string;
  cityName: string;
  cityCenter: [number, number];
  dataSource: string | null;
  dataSourceUrl: string | null;
  externalId: string;
  name: string;
  address: string | null;
  borough: string | null;
  neighborhood: string | null;
  postcode: string | null;
  councilDistrict: string | null;
  constructionType: string | null;
  startDate: string | null;
  completionDate: string | null;
  lat: number;
  lng: number;
  units: {
    total: number;
    extremelyLow: number;
    veryLow: number;
    low: number;
    moderate: number;
    middle: number;
    other: number;
  };
}

export async function getProject(
  cityId: string,
  externalId: string,
): Promise<ProjectRecord | null> {
  if (!hasDatabase()) return null;
  const res = await db.query<{
    city_id: string;
    city_name: string;
    center_lat: number;
    center_lng: number;
    data_source: string | null;
    data_source_url: string | null;
    external_id: string;
    name: string;
    address: string | null;
    borough: string | null;
    neighborhood: string | null;
    postcode: string | null;
    council_district: string | null;
    construction_type: string | null;
    start_date: Date | null;
    completion_date: Date | null;
    lat: number;
    lng: number;
    units_total: number;
    units_extremely_low: number;
    units_very_low: number;
    units_low: number;
    units_moderate: number;
    units_middle: number;
    units_other_income: number;
  }>(
    `
    SELECT
      p.city_id,
      c.name AS city_name,
      c.center_lat,
      c.center_lng,
      c.data_source,
      c.data_source_url,
      p.external_id,
      p.name,
      p.address,
      p.borough,
      p.neighborhood,
      p.postcode,
      p.council_district,
      p.construction_type,
      p.start_date,
      p.completion_date,
      ST_Y(p.geom::geometry) AS lat,
      ST_X(p.geom::geometry) AS lng,
      p.units_total,
      p.units_extremely_low,
      p.units_very_low,
      p.units_low,
      p.units_moderate,
      p.units_middle,
      p.units_other_income
    FROM projects p
    JOIN cities c ON c.id = p.city_id
    WHERE p.city_id = $1 AND p.external_id = $2
    LIMIT 1;
    `,
    [cityId, externalId],
  );

  if (res.rowCount === 0) return null;
  const r = res.rows[0];
  return {
    cityId: r.city_id,
    cityName: r.city_name,
    cityCenter: [r.center_lat, r.center_lng],
    dataSource: r.data_source,
    dataSourceUrl: r.data_source_url,
    externalId: r.external_id,
    name: r.name,
    address: r.address,
    borough: r.borough,
    neighborhood: r.neighborhood,
    postcode: r.postcode,
    councilDistrict: r.council_district,
    constructionType: r.construction_type,
    startDate: r.start_date ? r.start_date.toISOString().slice(0, 10) : null,
    completionDate: r.completion_date
      ? r.completion_date.toISOString().slice(0, 10)
      : null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    units: {
      total: Number(r.units_total ?? 0),
      extremelyLow: Number(r.units_extremely_low ?? 0),
      veryLow: Number(r.units_very_low ?? 0),
      low: Number(r.units_low ?? 0),
      moderate: Number(r.units_moderate ?? 0),
      middle: Number(r.units_middle ?? 0),
      other: Number(r.units_other_income ?? 0),
    },
  };
}
