import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";

interface PageProps {
  params: Promise<{ city: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { city, id } = await params;
  const project = await getProject(city, id);
  if (!project) {
    return { title: "groundwork — project not found" };
  }
  const where = [project.borough, project.cityName].filter(Boolean).join(", ");
  const desc = `${project.units.total.toLocaleString()} units ${where ? `in ${where}` : ""}`
    .trim()
    .replace(/\s+/g, " ");
  return {
    title: `${project.name} — groundwork`,
    description: desc,
    openGraph: {
      title: project.name,
      description: desc,
    },
    twitter: {
      title: project.name,
      description: desc,
      card: "summary_large_image",
    },
  };
}

export default async function ProjectPage({ params }: PageProps) {
  const { city, id } = await params;
  const project = await getProject(city, id);
  if (!project) notFound();

  const tiers = [
    { label: "Extremely Low Income", value: project.units.extremelyLow },
    { label: "Very Low Income", value: project.units.veryLow },
    { label: "Low Income", value: project.units.low },
    { label: "Moderate Income", value: project.units.moderate },
    { label: "Middle Income", value: project.units.middle },
    { label: "Market / Other", value: project.units.other },
  ].filter((t) => t.value > 0);
  const tierSum = tiers.reduce((acc, t) => acc + t.value, 0);

  // Link back to the live map zoomed onto this project.
  const mapHref = `/?city=${encodeURIComponent(project.cityId)}&project=${encodeURIComponent(project.externalId)}`;

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-3xl mx-auto">
        <Link
          href={mapHref}
          className="text-[11px] font-mono text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          ← back to the {project.cityName} map
        </Link>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            {project.cityName} · project #{project.externalId}
          </div>
          <h1 className="text-2xl font-semibold mt-1">{project.name}</h1>
          {project.address ? (
            <p className="text-sm font-mono text-[var(--text-2)] mt-1">
              {project.address}
              {project.borough ? `, ${project.borough}` : ""}
              {project.postcode ? ` ${project.postcode}` : ""}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-8">
          <Stat label="Total units" value={project.units.total.toLocaleString()} />
          <Stat label="Construction" value={project.constructionType ?? "—"} />
          <Stat
            label="Started"
            value={project.startDate ? project.startDate.slice(0, 7) : "—"}
          />
        </div>

        {tierSum > 0 ? (
          <section className="mt-8">
            <h2 className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-2">
              By income tier
            </h2>
            <div
              className="flex h-2 rounded-full overflow-hidden"
              style={{ background: "var(--surface-2)" }}
            >
              {tiers.map((t, i) => (
                <div
                  key={t.label}
                  style={{
                    width: `${(t.value / tierSum) * 100}%`,
                    background: TIER_COLORS[i],
                  }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-col gap-1">
              {tiers.map((t, i) => (
                <li key={t.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: TIER_COLORS[i] }}
                  />
                  <span className="flex-1 text-[var(--text-2)]">{t.label}</span>
                  <span className="font-mono">{t.value.toLocaleString()}</span>
                  <span className="font-mono text-[var(--text-3)] w-10 text-right">
                    {((t.value / tierSum) * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {project.dataSourceUrl ? (
          <p className="mt-10 text-[10px] font-mono text-[var(--text-3)]">
            source:{" "}
            <a
              href={project.dataSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--accent)]"
            >
              {project.dataSource ?? project.cityName}
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded p-3 text-center" style={{ background: "var(--surface-2)" }}>
      <div className="text-lg font-semibold font-mono">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)] mt-0.5">
        {label}
      </div>
    </div>
  );
}

const TIER_COLORS = [
  "#6dd0a4",
  "#8cd8a8",
  "#b8e2a4",
  "#e0d489",
  "#d4a45f",
  "#8a8a8a",
];
