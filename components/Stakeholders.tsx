"use client";

import { useEffect, useState } from "react";
import { Mail, Phone, ExternalLink, User } from "lucide-react";

interface Sibling {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  unitsTotal: number;
  constructionType: string | null;
  startDate: string | null;
}

interface Rep {
  district: string;
  name: string;
  party: string | null;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
}

interface Response {
  representative: Rep | null;
  summary: { projectCount: number; unitTotal: number };
  siblings: Sibling[];
}

interface Props {
  cityId: string;
  district: string;
  currentProjectId: string;
  onSelect: (projectId: string) => void;
}

export default function Stakeholders({ cityId, district, currentProjectId, onSelect }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ city: cityId, district, exclude: currentProjectId });
    fetch(`/api/stakeholders?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Response) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cityId, district, currentProjectId]);

  if (error) {
    return (
      <div className="text-[10px] font-mono text-[var(--text-3)]">
        stakeholders unavailable
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-[10px] font-mono text-[var(--text-3)]">loading representative…</div>
    );
  }

  const rep = data.representative;
  const label = cityId === "sfo" ? "Supervisor" : "Council Member";
  const districtLabel = cityId === "sfo" ? `District ${district}` : `District ${district}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
        Represented by
      </div>

      {rep ? (
        <div
          className="flex items-start gap-3 p-3 rounded-md"
          style={{ background: "var(--surface-2)" }}
        >
          {rep.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={rep.photoUrl}
              alt={rep.name}
              width={48}
              height={48}
              className="rounded-md object-cover flex-shrink-0"
              style={{ width: 48, height: 48 }}
            />
          ) : (
            <div
              className="rounded-md flex items-center justify-center flex-shrink-0"
              style={{ width: 48, height: 48, background: "var(--surface)" }}
            >
              <User size={20} className="text-[var(--text-3)]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-[var(--text-3)]">
              {label} · {districtLabel}
            </div>
            <div className="text-sm font-semibold text-[var(--text)] leading-tight mt-0.5">
              {rep.name}
            </div>
            <div className="flex flex-wrap gap-2 mt-1.5 text-[10px] font-mono">
              {rep.email ? (
                <a
                  href={`mailto:${rep.email}`}
                  className="inline-flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--accent)]"
                >
                  <Mail size={10} />
                  email
                </a>
              ) : null}
              {rep.phone ? (
                <a
                  href={`tel:${rep.phone}`}
                  className="inline-flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--accent)]"
                >
                  <Phone size={10} />
                  {rep.phone}
                </a>
              ) : null}
              {rep.websiteUrl ? (
                <a
                  href={rep.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--accent)]"
                >
                  <ExternalLink size={10} />
                  page
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-[var(--text-2)]">
          No representative on file for {districtLabel}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded p-2 text-center" style={{ background: "var(--surface-2)" }}>
          <div className="text-base font-semibold text-[var(--text)] font-mono">
            {data.summary.projectCount.toLocaleString()}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)] mt-0.5">
            Projects in district
          </div>
        </div>
        <div className="rounded p-2 text-center" style={{ background: "var(--surface-2)" }}>
          <div className="text-base font-semibold text-[var(--text)] font-mono">
            {data.summary.unitTotal.toLocaleString()}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-[var(--text-3)] mt-0.5">
            Total units in pipeline
          </div>
        </div>
      </div>

      {data.siblings.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)] mb-1.5">
            Other projects in this district
          </div>
          <ul className="flex flex-col gap-1">
            {data.siblings.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className="w-full text-left rounded px-2 py-1.5 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--text)] truncate">{s.name}</span>
                    <span className="text-[10px] font-mono text-[var(--text-2)] flex-shrink-0">
                      {s.unitsTotal.toLocaleString()} u
                    </span>
                  </div>
                  {s.address || s.neighborhood ? (
                    <div className="text-[10px] font-mono text-[var(--text-3)] truncate">
                      {s.address ?? s.neighborhood}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
