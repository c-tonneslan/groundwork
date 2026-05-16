import Link from "next/link";
import type { Metadata } from "next";
import { targets } from "@/lib/targets";

export const metadata: Metadata = {
  title: "methodology — groundwork",
  description:
    "Where the data comes from, how derived numbers are computed, and the known caveats. groundwork is a public dataset viewer for U.S. affordable-housing production.",
};

export default function MethodologyPage() {
  return (
    <main
      className="px-6 py-10"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        color: "var(--text)",
        overflow: "auto",
      }}
    >
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-baseline justify-between">
          <Link
            href="/"
            className="font-mono tracking-wider text-[var(--accent)] hover:underline"
            style={{ fontSize: "0.95rem" }}
          >
            ← groundwork
          </Link>
          <span className="text-[10px] font-mono text-[var(--text-3)] uppercase tracking-widest">
            methodology
          </span>
        </div>

        <h1 className="text-2xl font-semibold mb-2">Methodology</h1>
        <p className="text-sm text-[var(--text-2)] leading-relaxed mb-8">
          groundwork is a viewer for public housing data. Every number on the
          map and in the panels comes from an open dataset or a hand-written
          loader script that anyone can run against the same source. This page
          documents where everything comes from and where it gets fuzzy.
        </p>

        <Section title="Projects per city">
          <p>
            One loader per city under{" "}
            <code className="font-mono text-[var(--accent)]">scripts/</code> in
            the repo. Each pulls from that city&apos;s open-data API, maps the
            local schema onto a shared{" "}
            <code className="font-mono text-[var(--accent)]">projects</code>{" "}
            table, and writes it to Postgres. Re-runnable, idempotent on{" "}
            <code className="font-mono text-[var(--accent)]">
              (city_id, external_id)
            </code>
            .
          </p>
          <ul className="mt-3 space-y-1.5 text-[12px]">
            <li>
              <strong>New York.</strong>{" "}
              <Lk href="https://data.cityofnewyork.us/dataset/Affordable-Housing-Production-by-Building/hg8x-zxpr">
                NYC Open Data — Affordable Housing Production by Building
              </Lk>{" "}
              (HPD). Aggregated to project level, one marker per project.
            </li>
            <li>
              <strong>San Francisco.</strong>{" "}
              <Lk href="https://data.sfgov.org/Housing-and-Buildings/Affordable-Housing-Pipeline/aaxw-2cb8">
                SF DataSF — Affordable Housing Pipeline
              </Lk>{" "}
              (MOHCD).
            </li>
            <li>
              <strong>Los Angeles.</strong>{" "}
              <Lk href="https://geohub.lacity.org/datasets/lahub::affordable-housing">
                LA GeoHub — Affordable Housing
              </Lk>{" "}
              (HCID/LA).
            </li>
            <li>
              <strong>Washington DC.</strong>{" "}
              <Lk href="https://opendata.dc.gov/datasets/affordable-housing">
                DC Open Data — Affordable Housing
              </Lk>
              .
            </li>
            <li>
              <strong>Chicago.</strong>{" "}
              <Lk href="https://data.cityofchicago.org/Community-Economic-Development/Affordable-Rental-Housing-Developments/s6ha-ppgi">
                Chicago Data Portal — Affordable Rental Housing Developments
              </Lk>
              .
            </li>
            <li>
              <strong>Philadelphia.</strong>{" "}
              <Lk href="https://opendataphilly.org/datasets/affordable-housing-developments/">
                OpenDataPhilly — Affordable Housing Production
              </Lk>{" "}
              (Phila. Housing Development Corp).
            </li>
          </ul>
        </Section>

        <Section title="Rent-burden choropleth + supply-demand gap">
          <p>
            Census tract polygons come from the U.S. Census Bureau&apos;s{" "}
            <Lk href="https://tigerweb.geo.census.gov/">TIGERweb</Lk> service.
            Population, median income, renter household counts, and rent-burden
            counts come from the{" "}
            <Lk href="https://www.census.gov/data/developers/data-sets/acs-5year.html">
              ACS 5-year (2022)
            </Lk>{" "}
            via the Census API.
          </p>
          <p>
            The supply-demand gap is a PostGIS spatial join. For every tract,
            we count rent-burdened households (ACS) against the total
            affordable units in any project within 1 km of the tract centroid.
            The number reported is{" "}
            <code className="font-mono text-[var(--accent)]">
              burdened_households / nearby_affordable_units
            </code>{" "}
            — higher = worse-served. We exclude tracts with fewer than 100
            renter households to keep the ratio meaningful.
          </p>
          <p>
            &quot;Rent-burdened&quot; here is the ACS standard: a household
            paying 30% or more of household income on gross rent.
            &quot;Severely rent-burdened&quot; is the 50%+ subset, which we
            collect but don&apos;t currently surface in the gap ranking.
          </p>
        </Section>

        <Section title="Stakeholders panel">
          <p>
            Council district and community board, where available, come from
            the city&apos;s own dataset. The elected representative for each
            district is scraped by{" "}
            <code className="font-mono text-[var(--accent)]">
              scripts/load-council.mjs
            </code>
            , which pulls from either the city&apos;s official roster page or
            Wikipedia depending on what&apos;s reachable and parseable.
          </p>
          <p>
            This is the most fragile data on the page. NYC carries council
            district on the project record itself, so the surface area for
            error is small. Other cities don&apos;t, and we don&apos;t do a
            point-in-polygon back-fill yet, so the rep shown can be missing or
            stale. Treat it as a starting point, not an audit.
          </p>
        </Section>

        <Section title="Production trends (units per year by income tier)">
          <p>
            We compute the &quot;year&quot; of each project as{" "}
            <code className="font-mono text-[var(--accent)]">
              COALESCE(start_date, completion_date)
            </code>
            , whichever the city&apos;s feed provides. Income tier columns
            (Extremely Low → Middle Income → Other) come straight from each
            project record where available, summed within each year.
          </p>
          <p>
            Income tiers are not strictly comparable across cities. Each city
            defines &quot;Extremely Low&quot; against its own AMI, which floats
            year to year and HUD region to HUD region. Cross-city comparison is
            directional, not exact. Chicago&apos;s feed has neither a start nor
            a completion date for its projects, so its trends panel is empty.
          </p>
        </Section>

        <Section title="Production vs published target">
          <p>
            For cities with a real, public housing-production commitment, we
            chart cumulative units delivered each year against a linear
            trajectory to the stated goal. The targets come from the agency
            documents linked below.
          </p>
          <p>
            &quot;Pace&quot; is the ratio of (units delivered as of the latest
            data year) to (units the linear trajectory would expect by that
            year). It is a rough on-track signal, not an audit — cities
            front-load or back-load production for political and financing
            reasons that this chart can&apos;t see.
          </p>
          <ul className="mt-3 space-y-3 text-[12px]">
            {targets.map((t) => (
              <li key={t.cityId}>
                <div className="font-semibold text-[var(--text)]">
                  {t.name}{" "}
                  <span className="font-normal text-[var(--text-3)] font-mono text-[11px]">
                    · {t.targetUnits.toLocaleString()} units by {t.targetYear}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-2)] mt-0.5">
                  {t.notes}
                </div>
                <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                  <Lk href={t.sourceUrl}>{t.agency}</Lk>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Where the math breaks down">
          <ul className="space-y-2 list-disc list-inside">
            <li>
              <strong>Definitions drift.</strong> &quot;Affordable&quot; is not
              one thing. It includes units priced for ELI to middle income, all
              the way to 165% AMI in NYC&apos;s case. The chart legend reflects
              this; the headline numbers (&quot;X units delivered&quot;) don&apos;t.
            </li>
            <li>
              <strong>Dataset lag.</strong> Each city refreshes on its own
              cadence — daily for NYC, monthly for some, sporadic for others.
              The fetchedAt timestamp on each city&apos;s data is shown in the
              sidebar.
            </li>
            <li>
              <strong>Open data is not all data.</strong> Federally financed
              LIHTC projects don&apos;t all appear in city pipelines. Where a
              city&apos;s open dataset misses projects, we miss them too.
            </li>
            <li>
              <strong>Geocoding quirks.</strong> A handful of project lat/lngs
              are clearly wrong (literal middle-of-the-ocean coordinates from
              upstream geocoder errors). We don&apos;t silently drop them; we
              just render them where the data says.
            </li>
          </ul>
        </Section>

        <Section title="Source code">
          <p>
            All of it is at{" "}
            <Lk href="https://github.com/c-tonneslan/groundwork">
              github.com/c-tonneslan/groundwork
            </Lk>
            . Every loader, every SQL query, every chart. If you spot something
            wrong or have a city target source we should add, open an issue.
          </p>
          <p className="text-[var(--text-3)] mt-3 text-[11px] font-mono">
            MIT-licensed. Cite as: Tonneslan, C. (2026). groundwork.{" "}
            github.com/c-tonneslan/groundwork.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-3 text-[var(--text)]">{title}</h2>
      <div className="text-[13px] text-[var(--text-2)] leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function Lk({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--accent)] hover:underline"
    >
      {children}
    </a>
  );
}
