import type { Metadata } from "next";
import Link from "next/link";
import { db, hasDatabase } from "@/lib/db";

export const metadata: Metadata = {
  title: "Data sources — groundwork",
  description:
    "Where each city's affordable-housing data comes from, what it covers, and what it leaves out.",
};

// One row per city. Caveats are what I learned writing the loaders —
// the kind of thing that doesn't make it into a city's data dictionary
// but matters if you're going to cite a number.
const CAVEATS: Record<string, string> = {
  nyc: "Project-level, aggregated from HPD's building-level dataset. Carries start dates but not completion dates. Council district + community board are on the record. Income-tier counts are reliable.",
  sfo: "MOHCD pipeline — projects in active development, occupied, and historical. Start dates yes, completion dates only on closed projects. Supervisor district isn't on the record.",
  lax: "LAHD's funded-projects list back to 2003. Carries both start and completion dates. Council district is on the record. AMI tiers map to LAHD's own definitions, which don't line up 1:1 with HPD's.",
  dc: "Carries completion dates only. Ward is on the record. The 'income tier' field is binary (affordable vs market), not banded by AMI.",
  chi: "No temporal data at all — the city publishes the current inventory without project-start or completion dates. Trends and expiration views are blank for Chicago.",
  phl: "ArcGIS feature service, ~490 records. Carries a fiscal-year completion field that we fold to January 1 of that year. Council district isn't on the record; address is, so a spatial join against the council layer could fill it in.",
  bos: "BPDA Parcels with Income-Restricted Units. The official inventory is published as parcel polygons; we collapse each to a centroid for the map. Address + owner name are on the record. No start or completion dates, no AMI tier breakdown.",
  sea: "HUD's national LIHTC database (Seattle subset). Seattle's own portal doesn't publish a project-level inventory, so this is the next-best primary source: ~295 LIHTC properties placed in service since 1987, with year-placed-in-service, address, total + low-income unit counts, and bedroom mix. No per-tier AMI breakdown.",
  aus: "Austin NHCD's affordable housing inventory. Carries both affordability_start_date and affordability_expiration_date (Austin's the only city in this dataset with real expiration dates instead of the +30y estimate). MFI bands (20/30/40/50/60/65/70/80/100/120) map onto our ELI/VLI/LI/Mod/Mid tiers.",
};

interface CityRow {
  id: string;
  name: string;
  data_source: string | null;
  data_source_url: string | null;
  fetched_at: Date | null;
  project_count: number;
}

async function loadCities(): Promise<CityRow[]> {
  if (!hasDatabase()) return [];
  try {
    const res = await db.query<CityRow>(`
      SELECT
        c.id, c.name, c.data_source, c.data_source_url, c.fetched_at,
        COALESCE(p.project_count, 0)::int AS project_count
      FROM cities c
      LEFT JOIN (
        SELECT city_id, COUNT(*)::int AS project_count
        FROM projects
        GROUP BY city_id
      ) p ON p.city_id = c.id
      ORDER BY c.name
    `);
    return res.rows;
  } catch {
    return [];
  }
}

export default async function DataSourcesPage() {
  const cities = await loadCities();

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-[11px] font-mono text-[var(--text-2)] hover:text-[var(--accent)]">
          ← back to the map
        </Link>

        <h1 className="text-2xl font-semibold mt-6">Data sources</h1>
        <p className="text-sm text-[var(--text-2)] leading-relaxed mt-3 max-w-2xl">
          Every city publishes its affordable-housing data differently. This
          page is the receipts: what we pull from, when we last pulled it,
          and what to watch out for when citing a number.
        </p>

        {cities.length === 0 ? (
          <div
            className="mt-10 rounded p-6 text-sm text-[var(--text-2)]"
            style={{ background: "var(--surface-2)" }}
          >
            No cities loaded yet. Run a loader script
            (<code className="font-mono">node scripts/load-pg.mjs</code>, etc.)
            against a configured database.
          </div>
        ) : (
          <ul className="mt-10 flex flex-col gap-6">
            {cities.map((c) => {
              const caveat = CAVEATS[c.id];
              const fetched = c.fetched_at
                ? new Date(c.fetched_at).toISOString().slice(0, 10)
                : null;
              return (
                <li
                  key={c.id}
                  className="rounded-lg border p-5"
                  style={{
                    background: "var(--surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold">{c.name}</h2>
                    <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-3)]">
                      <span>{c.project_count.toLocaleString()} projects</span>
                      {fetched ? <span>fetched {fetched}</span> : <span>not yet loaded</span>}
                    </div>
                  </div>
                  {c.data_source ? (
                    <p className="text-sm font-mono text-[var(--text-2)] mt-2">
                      {c.data_source_url ? (
                        <a
                          href={c.data_source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline hover:text-[var(--accent)]"
                        >
                          {c.data_source}
                        </a>
                      ) : (
                        c.data_source
                      )}
                    </p>
                  ) : null}
                  {caveat ? (
                    <p className="text-[12px] text-[var(--text-2)] leading-relaxed mt-3">
                      {caveat}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-12 text-[11px] font-mono text-[var(--text-3)]">
          Notes on how cross-city comparisons are computed live on the{" "}
          <Link href="/methodology" className="underline-offset-2 hover:underline hover:text-[var(--accent)]">
            methodology
          </Link>{" "}
          page.
        </p>
      </div>
    </main>
  );
}
