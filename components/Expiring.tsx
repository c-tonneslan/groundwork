"use client";

import { X } from "lucide-react";

export interface ExpiringYear {
  year: number;
  units: number;
  projects: number;
}

export interface ExpiringProject {
  id: string;
  name: string;
  borough: string | null;
  year: number;
  units: number;
}

export interface ExpiringPayload {
  cityId: string;
  horizonYears: number;
  fromYear: number;
  throughYear: number;
  totalUnits: number;
  projectCount: number;
  years: ExpiringYear[];
  topProjects: ExpiringProject[];
}

interface Props {
  cityName: string;
  payload: ExpiringPayload | null;
  onClose: () => void;
  onSelect: (projectId: string) => void;
}

export default function Expiring({ cityName, payload, onClose, onSelect }: Props) {
  const empty = !payload || payload.totalUnits === 0;
  const maxUnits = payload
    ? Math.max(1, ...payload.years.map((y) => y.units))
    : 1;

  return (
    <div
      className="absolute top-4 left-4 w-[28rem] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] rounded-xl border overflow-y-auto"
      style={{
        background: "rgba(17,24,31,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        zIndex: 1000,
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-start justify-between gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
            Affordability expiring
          </div>
          <div className="text-sm font-semibold text-[var(--text)] leading-tight mt-0.5">
            {cityName} · next {payload?.horizonYears ?? 10} years
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--text-2)] hover:text-[var(--text)]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {empty ? (
          <div className="text-[11px] text-[var(--text-2)] leading-relaxed">
            No projects with a start or completion date in this city, so the
            30-year-from-PIS estimate can&apos;t run. Chicago&apos;s feed in
            particular carries neither date.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label={`Through ${payload!.throughYear}`}
                value={payload!.totalUnits.toLocaleString()}
                unit="units roll off"
              />
              <Stat
                label="Across"
                value={payload!.projectCount.toLocaleString()}
                unit="projects"
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-2">
                By year
              </div>
              <div className="flex flex-col gap-1">
                {payload!.years.map((y) => (
                  <div key={y.year} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-[var(--text-2)] w-10">{y.year}</span>
                    <div className="flex-1 h-2 rounded-sm" style={{ background: "var(--surface-2)" }}>
                      <div
                        style={{
                          width: `${(y.units / maxUnits) * 100}%`,
                          background: "#d4a45f",
                          height: "100%",
                          borderRadius: "2px",
                        }}
                      />
                    </div>
                    <span className="font-mono text-[var(--text)] w-16 text-right">
                      {y.units.toLocaleString()}
                    </span>
                    <span className="font-mono text-[var(--text-3)] w-10 text-right">
                      {y.projects}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {payload!.topProjects.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-2">
                  Largest at risk
                </div>
                <ul className="flex flex-col gap-1.5">
                  {payload!.topProjects.slice(0, 8).map((p) => (
                    <li
                      key={`${p.year}-${p.id}`}
                      onClick={() => onSelect(p.id)}
                      className="text-[11px] cursor-pointer hover:bg-[var(--surface-2)] rounded px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--text)] truncate">
                          {p.name}
                        </span>
                        <span className="font-mono text-[var(--text-2)] flex-shrink-0">
                          {p.units.toLocaleString()} units
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-3)] font-mono mt-0.5">
                        {p.borough ? `${p.borough} · ` : ""}expires ~{p.year}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[10px] text-[var(--text-3)] leading-relaxed pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              Estimated as <span className="font-mono">completion + 30 years</span> (or start date when completion isn&apos;t recorded). Real
              expiration depends on LIHTC extended-use agreements, regulatory
              periods set in each financing deal, and renewals — none of which
              are in the city portals.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded p-3" style={{ background: "var(--surface-2)" }}>
      <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)]">
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--text)] font-mono mt-0.5">
        {value}
      </div>
      <div className="text-[10px] text-[var(--text-2)] mt-0.5">{unit}</div>
    </div>
  );
}
