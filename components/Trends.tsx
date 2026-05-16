"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export interface TrendYear {
  year: number;
  projects: number;
  units: {
    total: number;
    extremelyLow: number;
    veryLow: number;
    low: number;
    moderate: number;
    middle: number;
    other: number;
  };
  construction: {
    newConstruction: number;
    preservation: number;
  };
}

interface Props {
  cityName: string;
  years: TrendYear[];
  onClose: () => void;
}

type TierKey =
  | "extremelyLow"
  | "veryLow"
  | "low"
  | "moderate"
  | "middle"
  | "other";

// Income tiers, ordered from deepest affordability (bottom of the
// stack) to shallowest (top). Colors run cool-to-warm so the bar
// reads "more green = serving lower incomes."
const TIERS: ReadonlyArray<{
  key: TierKey;
  label: string;
  color: string;
}> = [
  { key: "extremelyLow", label: "Extremely Low (≤30% AMI)", color: "#2c7d62" },
  { key: "veryLow",      label: "Very Low (31–50% AMI)",    color: "#3a9e8a" },
  { key: "low",          label: "Low (51–80% AMI)",         color: "#6dd0a4" },
  { key: "moderate",     label: "Moderate (81–120% AMI)",   color: "#c2d96a" },
  { key: "middle",       label: "Middle (121–165% AMI)",    color: "#e8c46a" },
  { key: "other",        label: "Other / unspecified",      color: "#5a6a7a" },
];

export default function Trends({ cityName, years, onClose }: Props) {
  const [hover, setHover] = useState<TrendYear | null>(null);

  // Trim leading/trailing zero years so charts don't anchor at 1995
  // for a city whose pipeline really starts in 2014.
  const trimmed = useMemo(() => {
    if (!years.length) return [] as TrendYear[];
    const firstReal = years.findIndex((y) => y.units.total > 0);
    const lastRealRev = [...years].reverse().findIndex((y) => y.units.total > 0);
    if (firstReal < 0) return [];
    const lastReal = years.length - 1 - lastRealRev;
    return years.slice(firstReal, lastReal + 1);
  }, [years]);

  const maxUnits = useMemo(
    () => Math.max(1, ...trimmed.map((y) => y.units.total)),
    [trimmed],
  );

  const totalUnits = useMemo(
    () => trimmed.reduce((sum, y) => sum + y.units.total, 0),
    [trimmed],
  );
  const totalProjects = useMemo(
    () => trimmed.reduce((sum, y) => sum + y.projects, 0),
    [trimmed],
  );

  const tierTotals = useMemo(() => {
    const t = { extremelyLow: 0, veryLow: 0, low: 0, moderate: 0, middle: 0, other: 0 };
    for (const y of trimmed) {
      t.extremelyLow += y.units.extremelyLow;
      t.veryLow += y.units.veryLow;
      t.low += y.units.low;
      t.moderate += y.units.moderate;
      t.middle += y.units.middle;
      t.other += y.units.other;
    }
    return t;
  }, [trimmed]);

  // SVG layout.
  const chartHeight = 220;
  const barGap = 4;

  return (
    <div
      className="absolute top-4 left-4 w-[36rem] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] rounded-xl border overflow-y-auto"
      style={{
        background: "rgba(17,24,31,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        zIndex: 1000,
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-start"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            {cityName} · production over time
          </div>
          <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
            Affordable units by year and income tier
          </div>
          <div className="text-[10px] text-[var(--text-3)] mt-1 font-mono">
            year = COALESCE(start_date, completion_date) from city open data
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

      {trimmed.length === 0 ? (
        <div className="px-4 py-8 text-xs text-[var(--text-2)] font-mono text-center">
          no dated projects available for this city
        </div>
      ) : (
        <>
          <div className="px-4 pt-4 pb-2 grid grid-cols-3 gap-3 text-[10px] font-mono">
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">
                total units
              </div>
              <div className="text-base text-[var(--text)] font-semibold mt-0.5">
                {totalUnits.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">
                projects
              </div>
              <div className="text-base text-[var(--text)] font-semibold mt-0.5">
                {totalProjects.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">
                years
              </div>
              <div className="text-base text-[var(--text)] font-semibold mt-0.5">
                {trimmed[0].year}–{trimmed[trimmed.length - 1].year}
              </div>
            </div>
          </div>

          <div className="px-4 pt-2 pb-3">
            <svg
              role="img"
              aria-label={`stacked bar chart of affordable units per year for ${cityName}`}
              viewBox={`0 0 ${trimmed.length * 40} ${chartHeight + 24}`}
              preserveAspectRatio="none"
              className="w-full"
              style={{ height: chartHeight + 24 }}
            >
              {trimmed.map((y, i) => {
                const x = i * 40 + barGap;
                const barW = 40 - barGap * 2;
                let yCursor = chartHeight;
                const tierRects = TIERS.map((tier) => {
                  const v = y.units[tier.key];
                  if (v <= 0) return null;
                  const h = (v / maxUnits) * chartHeight;
                  yCursor -= h;
                  return (
                    <rect
                      key={tier.key}
                      x={x}
                      y={yCursor}
                      width={barW}
                      height={h}
                      fill={tier.color}
                    />
                  );
                });
                return (
                  <g
                    key={y.year}
                    onMouseEnter={() => setHover(y)}
                    onMouseLeave={() => setHover((h) => (h?.year === y.year ? null : h))}
                    style={{ cursor: "default" }}
                  >
                    {/* invisible hit target spans full column height */}
                    <rect
                      x={i * 40}
                      y={0}
                      width={40}
                      height={chartHeight}
                      fill="transparent"
                    />
                    {tierRects}
                    <text
                      x={x + barW / 2}
                      y={chartHeight + 14}
                      textAnchor="middle"
                      fontSize={9}
                      fontFamily="monospace"
                      fill="var(--text-3)"
                    >
                      {String(y.year).slice(2)}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Hovered-year detail line. */}
            <div className="text-[10px] font-mono text-[var(--text-2)] mt-1 h-4">
              {hover ? (
                <>
                  <span className="text-[var(--accent)]">{hover.year}</span>
                  {" · "}
                  {hover.units.total.toLocaleString()} units across{" "}
                  {hover.projects} projects
                </>
              ) : (
                "hover a bar for year details"
              )}
            </div>
          </div>

          <div
            className="px-4 py-3 border-t"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-2">
              income tiers
            </div>
            <ul className="space-y-1">
              {TIERS.map((tier) => {
                const v = tierTotals[tier.key];
                const pct = totalUnits > 0 ? (v / totalUnits) * 100 : 0;
                if (v <= 0) return null;
                return (
                  <li
                    key={tier.key}
                    className="flex items-center gap-2 text-[11px] font-mono"
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ background: tier.color }}
                    />
                    <span className="text-[var(--text-2)] flex-1">{tier.label}</span>
                    <span className="text-[var(--text)] tabular-nums">
                      {v.toLocaleString()}
                    </span>
                    <span className="text-[var(--text-3)] tabular-nums w-10 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
