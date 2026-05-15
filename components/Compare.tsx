"use client";

import { X } from "lucide-react";
import type { CityMeta } from "@/lib/cities";

interface Props {
  cities: CityMeta[];
  onClose: () => void;
}

export default function Compare({ cities, onClose }: Props) {
  const withStats = cities.filter((c) => c.stats);

  if (withStats.length === 0) return null;

  // Headline numbers per city.
  const rows = withStats.map((c) => {
    const s = c.stats!;
    const affordableTotal =
      s.units.extremelyLow + s.units.veryLow + s.units.low + s.units.moderate + s.units.middle;
    const newPct = (s.construction.newConstruction / Math.max(1, s.projects)) * 100;
    return {
      city: c,
      projects: s.projects,
      total: s.units.total,
      affordable: affordableTotal,
      newPct,
      tiers: s.units,
      span:
        s.earliestStart && s.latestStart
          ? `${s.earliestStart.slice(0, 4)} – ${s.latestStart.slice(0, 4)}`
          : "—",
    };
  });

  const maxTotal = Math.max(...rows.map((r) => r.total));

  return (
    <div
      className="absolute top-4 right-4 max-w-[calc(100%-2rem)] w-[26rem] rounded-xl border overflow-y-auto"
      style={{
        background: "rgba(17,24,31,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        zIndex: 1000,
        maxHeight: "calc(100% - 2rem)",
      }}
    >
      <div className="px-4 py-3 border-b flex items-start" style={{ borderColor: "var(--border)" }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            Compare cities
          </div>
          <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
            Affordable housing pipelines
          </div>
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
        {/* Headline bar */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-1.5">
            Total units in pipeline
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <div key={r.city.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 truncate text-[var(--text-2)]">{r.city.name}</span>
                <div
                  className="flex-1 h-3 rounded overflow-hidden relative"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div
                    style={{
                      width: `${(r.total / maxTotal) * 100}%`,
                      background: "var(--accent)",
                      height: "100%",
                    }}
                  />
                </div>
                <span className="w-20 text-right font-mono text-[var(--text)]">
                  {r.total.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Project count + type mix */}
        <div className="grid grid-cols-3 gap-1.5">
          <Header label="Projects" />
          <Header label="New" />
          <Header label="Preservation" />
          {rows.map((r) => (
            <CityRowChunk key={r.city.id + "p"} city={r.city.name} value={r.projects.toLocaleString()} />
          ))}
          {rows.map((r) => (
            <ValueCell
              key={r.city.id + "n"}
              value={`${r.city.stats!.construction.newConstruction}`}
              hint={`${r.newPct.toFixed(0)}%`}
            />
          ))}
          {rows.map((r) => (
            <ValueCell
              key={r.city.id + "pr"}
              value={`${r.city.stats!.construction.preservation}`}
              hint={`${(100 - r.newPct).toFixed(0)}%`}
            />
          ))}
        </div>

        {/* Income tier mix */}
        <div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-1.5">
            Income tier mix (% of total units)
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r) => {
              const s = r.city.stats!.units;
              const sum =
                s.extremelyLow +
                s.veryLow +
                s.low +
                s.moderate +
                s.middle +
                s.other || 1;
              const segments: [string, number, string][] = [
                ["XL", s.extremelyLow, "#6dd0a4"],
                ["VL", s.veryLow, "#8cd8a8"],
                ["L", s.low, "#b8e2a4"],
                ["M", s.moderate, "#e0d489"],
                ["Mi", s.middle, "#d4a45f"],
                ["O", s.other, "#5a6a7a"],
              ];
              return (
                <div key={r.city.id} className="flex items-center gap-2 text-[10px]">
                  <span className="w-16 truncate text-[var(--text-2)]">{r.city.name}</span>
                  <div className="flex-1 flex h-2.5 rounded overflow-hidden">
                    {segments.map(([label, val, color]) => {
                      const pct = (val / sum) * 100;
                      if (pct < 0.5) return null;
                      return (
                        <div
                          key={label}
                          style={{ width: `${pct}%`, background: color }}
                          title={`${label}: ${val.toLocaleString()} (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2 text-[9px] font-mono text-[var(--text-3)] flex-wrap">
            <Legend color="#6dd0a4" label="Extremely Low" />
            <Legend color="#8cd8a8" label="Very Low" />
            <Legend color="#b8e2a4" label="Low" />
            <Legend color="#e0d489" label="Moderate" />
            <Legend color="#d4a45f" label="Middle" />
            <Legend color="#5a6a7a" label="Other" />
          </div>
        </div>

        {/* Span */}
        <div className="text-[10px] font-mono text-[var(--text-3)] pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          {rows.map((r) => (
            <div key={r.city.id}>
              {r.city.name}: data spans {r.span}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Header({ label }: { label: string }) {
  return (
    <div className="text-[9px] uppercase tracking-widest font-mono text-[var(--text-3)] col-span-1">
      {label}
    </div>
  );
}

function CityRowChunk({ city, value }: { city: string; value: string }) {
  return (
    <div className="text-[11px]">
      <div className="text-[9px] text-[var(--text-3)] font-mono">{city}</div>
      <div className="text-[var(--text)] font-mono">{value}</div>
    </div>
  );
}

function ValueCell({ value, hint }: { value: string; hint?: string }) {
  return (
    <div className="text-[11px]">
      <div className="text-[var(--text)] font-mono">{value}</div>
      {hint ? <div className="text-[9px] text-[var(--text-3)] font-mono">{hint}</div> : null}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
