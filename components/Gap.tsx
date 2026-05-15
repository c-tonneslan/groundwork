"use client";

import { X, ArrowRight } from "lucide-react";

export interface GapTract {
  geoid: string;
  name: string | null;
  population: number | null;
  medianIncome: number | null;
  renterHouseholds: number | null;
  rentBurdened: number | null;
  severelyRentBurdened: number | null;
  rentBurdenedPct: number | null;
  nearbyUnits: number;
  nearbyProjects: number;
  householdsPerUnit: number | null;
  centerLat: number;
  centerLng: number;
}

interface Props {
  cityName: string;
  tracts: GapTract[];
  radiusMeters: number;
  onClose: () => void;
  onFlyTo: (lat: number, lng: number) => void;
}

export default function Gap({ cityName, tracts, radiusMeters, onClose, onFlyTo }: Props) {
  if (!tracts.length) return null;

  const maxBurdened = Math.max(...tracts.map((t) => t.rentBurdened ?? 0), 1);

  return (
    <div
      className="absolute top-4 left-4 w-[26rem] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] rounded-xl border overflow-y-auto"
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
            {cityName} · supply–demand gap
          </div>
          <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
            Tracts with the worst affordable-unit coverage
          </div>
          <div className="text-[10px] text-[var(--text-3)] mt-1 font-mono">
            rent-burdened households per affordable unit within {(radiusMeters / 1000).toFixed(1)} km
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

      <ol className="divide-y" style={{ borderColor: "var(--border)" }}>
        {tracts.map((t, i) => {
          const pct = t.rentBurdenedPct ?? 0;
          const burdened = t.rentBurdened ?? 0;
          const widthPct = (burdened / maxBurdened) * 100;
          return (
            <li
              key={t.geoid}
              className="px-4 py-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
              onClick={() => onFlyTo(t.centerLat, t.centerLng)}
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-mono text-[var(--text-3)]">#{i + 1}</span>
                <span className="text-xs font-semibold text-[var(--text)]">
                  Tract {t.name ?? t.geoid}
                </span>
                <span className="ml-auto text-[10px] font-mono text-[var(--warning)]">
                  {t.householdsPerUnit != null
                    ? `${t.householdsPerUnit.toFixed(1)} hh/unit`
                    : "no units"}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[var(--text-3)] w-32 flex-shrink-0">
                  {burdened.toLocaleString()} burdened ({pct.toFixed(0)}%)
                </span>
                <div
                  className="flex-1 h-1.5 rounded overflow-hidden"
                  style={{ background: "var(--surface-2)" }}
                >
                  <div style={{ width: `${widthPct}%`, background: "var(--warning)", height: "100%" }} />
                </div>
              </div>

              <div className="mt-1.5 text-[10px] text-[var(--text-3)] font-mono flex items-center gap-3">
                <span>
                  median income {t.medianIncome ? `$${t.medianIncome.toLocaleString()}` : "—"}
                </span>
                <span>·</span>
                <span>
                  {t.nearbyProjects} project{t.nearbyProjects === 1 ? "" : "s"} ·{" "}
                  {t.nearbyUnits.toLocaleString()} units nearby
                </span>
                <ArrowRight size={10} className="ml-auto text-[var(--accent)]" />
              </div>
            </li>
          );
        })}
      </ol>

      <div
        className="px-4 py-3 border-t text-[10px] font-mono text-[var(--text-3)]"
        style={{ borderColor: "var(--border)" }}
      >
        ACS 2022 5-year. &quot;Nearby&quot; = within {(radiusMeters / 1000).toFixed(1)} km of the tract centroid.
      </div>
    </div>
  );
}
