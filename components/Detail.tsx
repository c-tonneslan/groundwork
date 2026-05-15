"use client";

import { X, ExternalLink } from "lucide-react";
import type { Project } from "@/lib/types";
import Stakeholders from "./Stakeholders";

interface Props {
  project: Project;
  cityId: string;
  onClose: () => void;
  onSelect: (projectId: string) => void;
}

export default function Detail({ project, cityId, onClose, onSelect }: Props) {
  const u = project.units;
  // Income-tier breakdown as percentages. Skip tiers with zero units.
  const tiers: { label: string; value: number }[] = [
    { label: "Extremely Low Income", value: u.extremelyLowIncome },
    { label: "Very Low Income", value: u.veryLowIncome },
    { label: "Low Income", value: u.lowIncome },
    { label: "Moderate Income", value: u.moderateIncome },
    { label: "Middle Income", value: u.middleIncome },
    { label: "Market / Other", value: u.otherIncome },
  ].filter((t) => t.value > 0);
  const sum = tiers.reduce((acc, t) => acc + t.value, 0);

  const brBreakdown = [
    { label: "Studio", value: u.studio },
    { label: "1 BR", value: u.oneBR },
    { label: "2 BR", value: u.twoBR },
    { label: "3 BR", value: u.threeBR },
    { label: "4+ BR", value: u.fourPlusBR },
  ].filter((b) => b.value > 0);

  const dsny = encodeURIComponent(
    `${project.name}${project.address ? ", " + project.address : ""} New York`,
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${dsny}`;

  return (
    <div
      className="absolute top-4 left-4 w-96 max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] rounded-xl border overflow-y-auto"
      style={{
        background: "rgba(17,24,31,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        // Leaflet panes sit at z-index 200-700 inside the map container;
        // we need to live above them so the detail panel isn't hidden
        // behind marker layers and controls.
        zIndex: 1000,
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-start gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            {cityId === "sfo" ? "MOHCD" : "HPD"} Project · #{project.id}
          </div>
          <div className="text-base font-semibold text-[var(--text)] leading-tight mt-0.5">
            {project.name}
          </div>
          {project.address ? (
            <div className="text-[11px] text-[var(--text-2)] font-mono mt-0.5">
              {project.address}
              {project.borough ? `, ${project.borough}` : ""}
              {project.postcode ? ` ${project.postcode}` : ""}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--text-2)] hover:text-[var(--text)] flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Top-level stats */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total units" value={u.total.toLocaleString()} />
          <Stat label="Counted" value={u.counted.toLocaleString()} />
          <Stat label="Buildings" value={String(project.buildings)} />
        </div>

        {/* Income tier bar */}
        {sum > 0 ? (
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-1.5">
              By income tier
            </div>
            <div
              className="flex h-2 rounded-full overflow-hidden"
              style={{ background: "var(--surface-2)" }}
            >
              {tiers.map((t, i) => (
                <div
                  key={t.label}
                  style={{
                    width: `${(t.value / sum) * 100}%`,
                    background: TIER_COLORS[i],
                  }}
                  title={`${t.label}: ${t.value}`}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-col gap-0.5">
              {tiers.map((t, i) => (
                <li key={t.label} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: TIER_COLORS[i] }}
                  />
                  <span className="flex-1 text-[var(--text-2)]">{t.label}</span>
                  <span className="font-mono text-[var(--text)]">{t.value.toLocaleString()}</span>
                  <span className="font-mono text-[var(--text-3)] w-10 text-right">
                    {((t.value / sum) * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Bedroom mix */}
        {brBreakdown.length > 0 ? (
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-1.5">
              Bedroom mix
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {brBreakdown.map((b) => (
                <div
                  key={b.label}
                  className="rounded p-2 text-center"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div className="text-[10px] text-[var(--text-3)] font-mono">{b.label}</div>
                  <div className="text-sm font-semibold text-[var(--text)]">{b.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <Meta label="Start date" value={project.startDate?.slice(0, 10) ?? "—"} />
          <Meta label="Construction" value={project.constructionType ?? "—"} />
          <Meta label="Council District" value={project.councilDistrict?.toString() ?? "—"} />
          <Meta label="Community Board" value={project.communityBoard ?? "—"} />
          <Meta label="Extended affordability" value={project.extendedAffordability ? "Yes" : "No"} />
          <Meta label="Prevailing wage" value={project.prevailingWage ? "Yes" : "No"} />
        </div>

        {/* Stakeholders */}
        {project.councilDistrict ? (
          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <Stakeholders
              key={`${cityId}-${project.councilDistrict}-${project.id}`}
              cityId={cityId}
              district={String(project.councilDistrict)}
              currentProjectId={project.id}
              onSelect={onSelect}
            />
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 px-3 py-2 rounded-md text-[11px] font-medium text-center"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            Open in Maps
          </a>
          <a
            href={`mailto:contact@hpd.nyc.gov?subject=${encodeURIComponent("Project inquiry: " + project.name)}`}
            className="flex-1 px-3 py-2 rounded-md text-[11px] font-medium text-center"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            Contact HPD
          </a>
        </div>

        <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <a
            href="https://data.cityofnewyork.us/dataset/Affordable-Housing-Production-by-Building/hg8x-zxpr"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            <ExternalLink size={9} />
            source: NYC Open Data
          </a>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded p-2.5 text-center" style={{ background: "var(--surface-2)" }}>
      <div className="text-lg font-semibold text-[var(--text)] font-mono">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)] mt-0.5">{label}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)] mb-0.5">{label}</div>
      <div className="text-[var(--text)] font-mono">{value}</div>
    </div>
  );
}

// Colors for income tiers, going from "most affordable" green to
// "moderate" yellow to "market" muted. Avoids red so the map doesn't
// look like it's flagging things as bad.
const TIER_COLORS = [
  "#6dd0a4",
  "#8cd8a8",
  "#b8e2a4",
  "#e0d489",
  "#d4a45f",
  "#8a8a8a",
];
