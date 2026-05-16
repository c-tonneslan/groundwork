"use client";

import { useCallback, useMemo, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import type { HousingTarget } from "@/lib/targets";

export interface ProgressPoint {
  year: number;
  units: number;
  cumulative: number;
  targetCumulative: number;
}

export interface ProgressPayload {
  cityId: string;
  target: HousingTarget | null;
  cumulative: ProgressPoint[];
  lastDataYear?: number;
  progress?: {
    delivered: number;
    expectedByNow: number;
    pctOfFinalTarget: number;
    pctOfExpected: number;
  };
  note?: string;
}

interface Props {
  cityName: string;
  payload: ProgressPayload | null;
  onClose: () => void;
}

const COLOR_TARGET = "#5a6a7a";
const COLOR_ACTUAL = "#6dd0a4";
const COLOR_BEHIND = "#e8c46a";

export default function Progress({ cityName, payload, onClose }: Props) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const target = payload?.target ?? null;
  const cumulative = useMemo(() => payload?.cumulative ?? [], [payload]);
  const progress = payload?.progress;

  const lastDataYear =
    payload?.lastDataYear ??
    (cumulative.length > 0 ? cumulative[cumulative.length - 1].year : null);

  // Chart geometry.
  const chartW = 560;
  const chartH = 200;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 22;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const maxY = useMemo(() => {
    if (cumulative.length === 0) return 1;
    return Math.max(
      ...cumulative.map((c) => Math.max(c.cumulative, c.targetCumulative)),
      1,
    );
  }, [cumulative]);

  const yearsRange = useMemo(() => {
    if (cumulative.length === 0) return { min: 0, max: 1 };
    return { min: cumulative[0].year, max: cumulative[cumulative.length - 1].year };
  }, [cumulative]);

  const xFor = useCallback(
    (year: number) => {
      const t =
        (year - yearsRange.min) / Math.max(yearsRange.max - yearsRange.min, 1);
      return padL + t * plotW;
    },
    [yearsRange, plotW],
  );
  const yFor = useCallback(
    (units: number) => {
      const t = units / maxY;
      return padT + (1 - t) * plotH;
    },
    [maxY, plotH],
  );

  const pathActual = useMemo(() => {
    if (cumulative.length === 0) return "";
    // Only draw the actual line through years up to lastDataYear, so we
    // don't visually imply we have data for the future.
    const points = cumulative
      .filter((c) => (lastDataYear == null ? true : c.year <= lastDataYear))
      .map((c, i) => `${i === 0 ? "M" : "L"}${xFor(c.year).toFixed(1)},${yFor(c.cumulative).toFixed(1)}`);
    return points.join(" ");
  }, [cumulative, lastDataYear, xFor, yFor]);

  const pathTarget = useMemo(() => {
    if (cumulative.length === 0) return "";
    const points = cumulative.map(
      (c, i) => `${i === 0 ? "M" : "L"}${xFor(c.year).toFixed(1)},${yFor(c.targetCumulative).toFixed(1)}`,
    );
    return points.join(" ");
  }, [cumulative, xFor, yFor]);

  // Highlighted point for hover or "as of" annotation.
  const focusPoint = useMemo(() => {
    if (cumulative.length === 0) return null;
    const yr = hoverYear ?? lastDataYear;
    if (yr == null) return null;
    return cumulative.find((c) => c.year === yr) ?? null;
  }, [cumulative, hoverYear, lastDataYear]);

  // No target on file for this city.
  if (!target) {
    return (
      <div
        className="absolute top-4 left-4 w-[36rem] max-w-[calc(100%-2rem)] rounded-xl border overflow-y-auto"
        style={{
          background: "rgba(17,24,31,0.96)",
          borderColor: "var(--border)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          zIndex: 1000,
        }}
      >
        <div className="px-4 py-3 border-b flex items-start" style={{ borderColor: "var(--border)" }}>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
              {cityName} · production vs plan
            </div>
            <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
              No published target on file
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-2)] hover:text-[var(--text)] flex-shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-6 text-xs text-[var(--text-2)] font-mono leading-relaxed">
          {payload?.note ?? "Nothing to compare against yet."}
          <br />
          <br />
          Have a source for this city&apos;s housing target? Open an issue or PR — see{" "}
          <a className="text-[var(--accent)]" href="/methodology">methodology</a>.
        </div>
      </div>
    );
  }

  const onTrack =
    progress != null && progress.pctOfExpected != null
      ? progress.pctOfExpected >= 95
        ? "on track"
        : progress.pctOfExpected >= 75
          ? "slightly behind"
          : "behind"
      : null;
  const trackColor =
    onTrack === "on track"
      ? COLOR_ACTUAL
      : onTrack === "slightly behind"
        ? COLOR_BEHIND
        : "#e87060";

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
      <div className="px-4 py-3 border-b flex items-start" style={{ borderColor: "var(--border)" }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            {cityName} · production vs published target
          </div>
          <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
            {target.name}
          </div>
          <div className="text-[10px] text-[var(--text-3)] mt-1 font-mono">
            {target.targetUnits.toLocaleString()} units by {target.targetYear} ·{" "}
            <a
              href={target.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] inline-flex items-center gap-0.5 hover:underline"
            >
              {target.agency.split(/[/.]/)[0].trim()}
              <ExternalLink size={9} />
            </a>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-2)] hover:text-[var(--text)] flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* Headline progress card. */}
      {progress ? (
        <div className="px-4 pt-3 pb-1">
          <div className="grid grid-cols-3 gap-3 text-[10px] font-mono">
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">delivered</div>
              <div className="text-base text-[var(--text)] font-semibold mt-0.5">
                {progress.delivered.toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-3)]">
                {progress.pctOfFinalTarget.toFixed(1)}% of {target.targetUnits.toLocaleString()} goal
              </div>
            </div>
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">expected by {lastDataYear}</div>
              <div className="text-base text-[var(--text)] font-semibold mt-0.5">
                {progress.expectedByNow.toLocaleString()}
              </div>
              <div className="text-[10px] text-[var(--text-3)]">
                linear pace toward {target.targetYear}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-3)] uppercase tracking-wider">pace</div>
              <div
                className="text-base font-semibold mt-0.5"
                style={{ color: trackColor }}
              >
                {progress.pctOfExpected.toFixed(0)}%
              </div>
              <div className="text-[10px] text-[var(--text-3)]">
                of where a straight line would put you
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-4 pt-2 pb-3">
        <svg
          role="img"
          aria-label={`cumulative units delivered vs target for ${cityName}`}
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full"
          style={{ height: "auto" }}
        >
          {/* Y axis gridlines + labels (4 ticks). */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const v = Math.round(maxY * frac);
            const y = padT + (1 - frac) * plotH;
            return (
              <g key={frac}>
                <line x1={padL} x2={chartW - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={9}
                  fontFamily="monospace"
                  fill="var(--text-3)"
                >
                  {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                </text>
              </g>
            );
          })}

          {/* X axis year labels — every other year if we have many. */}
          {cumulative.map((c, i) => {
            const step = cumulative.length > 12 ? 2 : 1;
            if (i % step !== 0 && i !== cumulative.length - 1) return null;
            return (
              <text
                key={c.year}
                x={xFor(c.year)}
                y={chartH - padB + 14}
                textAnchor="middle"
                fontSize={9}
                fontFamily="monospace"
                fill="var(--text-3)"
              >
                {String(c.year).slice(2)}
              </text>
            );
          })}

          {/* Target line. */}
          <path d={pathTarget} fill="none" stroke={COLOR_TARGET} strokeWidth={1.5} strokeDasharray="3 3" />

          {/* Actual line. */}
          <path d={pathActual} fill="none" stroke={COLOR_ACTUAL} strokeWidth={2.5} />

          {/* Focus point. */}
          {focusPoint ? (
            <g>
              <circle
                cx={xFor(focusPoint.year)}
                cy={yFor(focusPoint.cumulative)}
                r={4}
                fill={COLOR_ACTUAL}
                stroke="var(--bg)"
                strokeWidth={1}
              />
              <line
                x1={xFor(focusPoint.year)}
                x2={xFor(focusPoint.year)}
                y1={padT}
                y2={chartH - padB}
                stroke="var(--text-3)"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
            </g>
          ) : null}

          {/* Mouse capture row. */}
          {cumulative.map((c, i) => {
            const x0 = i === 0 ? padL : (xFor(cumulative[i - 1].year) + xFor(c.year)) / 2;
            const x1 =
              i === cumulative.length - 1
                ? chartW - padR
                : (xFor(c.year) + xFor(cumulative[i + 1].year)) / 2;
            return (
              <rect
                key={c.year}
                x={x0}
                y={padT}
                width={x1 - x0}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverYear(c.year)}
                onMouseLeave={() =>
                  setHoverYear((h) => (h === c.year ? null : h))
                }
              />
            );
          })}
        </svg>

        {/* Hover/as-of detail line. */}
        <div className="text-[10px] font-mono text-[var(--text-2)] mt-1 h-4">
          {focusPoint ? (
            <>
              <span className="text-[var(--accent)]">{focusPoint.year}</span>
              {" · "}
              {focusPoint.cumulative.toLocaleString()} delivered
              {" / "}
              {focusPoint.targetCumulative.toLocaleString()} expected
              {" · "}
              {focusPoint.units.toLocaleString()} units that year
            </>
          ) : (
            "hover the chart for year details"
          )}
        </div>

        {/* Legend. */}
        <div className="flex items-center gap-4 mt-2 text-[10px] font-mono">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5" style={{ background: COLOR_ACTUAL }} />
            <span className="text-[var(--text-2)]">actual cumulative</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-0 border-t border-dashed"
              style={{ borderColor: COLOR_TARGET }}
            />
            <span className="text-[var(--text-2)]">target pace (linear)</span>
          </span>
        </div>
      </div>

      <div
        className="px-4 py-3 border-t text-[10px] font-mono text-[var(--text-3)] leading-relaxed"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[var(--text-2)]">methodology.</span> {target.notes}
        {" "}
        <a className="text-[var(--accent)]" href="/methodology">
          full methodology →
        </a>
      </div>
    </div>
  );
}
