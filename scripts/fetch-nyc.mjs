// Pull NYC's "Affordable Housing Production by Building" dataset (the
// one with lat/lng AND the unit-tier breakdowns), aggregate to project
// level, and write to /public for the frontend to consume statically.
//
//   node scripts/fetch-nyc.mjs
//
// Re-run whenever you want a fresh snapshot.

import { writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ENDPOINT = "https://data.cityofnewyork.us/resource/hg8x-zxpr.json";
const OUT_DIR = path.resolve(process.cwd(), "public");

async function fetchPage(offset, limit = 5000) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("$limit", String(limit));
  url.searchParams.set("$offset", String(offset));
  url.searchParams.set("$order", "project_start_date DESC");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`socrata ${resp.status}: ${resp.statusText} :: ${await resp.text()}`);
  return await resp.json();
}

function num(v) {
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function makeEmptyProject(row) {
  return {
    id: row.project_id,
    name: (row.project_name || "").trim() || "(unnamed)",
    startDate: row.project_start_date || null,
    borough: row.borough || null,
    address: [row.house_number, row.street_name].filter(Boolean).join(" ").trim() || null,
    postcode: row.postcode || null,
    constructionType: row.reporting_construction_type || null,
    extendedAffordability: row.extended_affordability_status === "Yes",
    prevailingWage: row.prevailing_wage_status === "Prevailing Wage",
    councilDistrict: row.council_district ? parseInt(row.council_district, 10) : null,
    communityBoard: row.community_board || null,
    neighborhood: row.neighborhood_tabulation_area || null,
    buildings: 0,
    lat: 0,
    lng: 0,
    _latSum: 0,
    _lngSum: 0,
    units: {
      total: 0,
      counted: 0,
      rental: 0,
      homeownership: 0,
      extremelyLowIncome: 0,
      veryLowIncome: 0,
      lowIncome: 0,
      moderateIncome: 0,
      middleIncome: 0,
      otherIncome: 0,
      studio: 0,
      oneBR: 0,
      twoBR: 0,
      threeBR: 0,
      fourPlusBR: 0,
    },
  };
}

function fold(project, row) {
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    project._latSum += lat;
    project._lngSum += lng;
    project.buildings += 1;
  }
  project.units.total += num(row.total_units);
  project.units.counted += num(row.all_counted_units);
  project.units.rental += num(row.counted_rental_units);
  project.units.homeownership += num(row.counted_homeownership_units);
  project.units.extremelyLowIncome += num(row.extremely_low_income_units);
  project.units.veryLowIncome += num(row.very_low_income_units);
  project.units.lowIncome += num(row.low_income_units);
  project.units.moderateIncome += num(row.moderate_income_units);
  project.units.middleIncome += num(row.middle_income_units);
  project.units.otherIncome += num(row.other_income_units);
  project.units.studio += num(row.studio_units);
  project.units.oneBR += num(row._1_br_units);
  project.units.twoBR += num(row._2_br_units);
  project.units.threeBR += num(row._3_br_units);
  project.units.fourPlusBR +=
    num(row._4_br_units) + num(row._5_br_units) + num(row._6_br_units);
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const byProject = new Map();
  let offset = 0;
  const limit = 5000;
  let rawCount = 0;

  while (true) {
    process.stdout.write(`\rfetching offset ${offset}...`);
    const page = await fetchPage(offset, limit);
    if (!page.length) break;
    rawCount += page.length;
    for (const row of page) {
      const id = row.project_id;
      if (!id) continue;
      let p = byProject.get(id);
      if (!p) {
        p = makeEmptyProject(row);
        byProject.set(id, p);
      }
      fold(p, row);
    }
    if (page.length < limit) break;
    offset += limit;
  }
  process.stdout.write("\n");

  // Compute centroid lat/lng per project, drop scratch fields.
  const projects = [];
  for (const p of byProject.values()) {
    if (p.buildings === 0) continue;
    p.lat = p._latSum / p.buildings;
    p.lng = p._lngSum / p.buildings;
    delete p._latSum;
    delete p._lngSum;
    projects.push(p);
  }
  projects.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));

  const out = path.join(OUT_DIR, "nyc-housing.json");
  await writeFile(
    out,
    JSON.stringify({
      source: "NYC HPD Affordable Housing Production by Building",
      sourceUrl:
        "https://data.cityofnewyork.us/dataset/Affordable-Housing-Production-by-Building/hg8x-zxpr",
      fetchedAt: new Date().toISOString(),
      rawRowCount: rawCount,
      projectCount: projects.length,
      projects,
    }),
  );
  const kb = (await stat(out)).size / 1024;
  console.log(
    `wrote ${out}  (${projects.length} projects from ${rawCount} building rows, ${kb.toFixed(0)} KB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
