"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Sidebar, { type Filters } from "@/components/Sidebar";
import Detail from "@/components/Detail";
import Compare from "@/components/Compare";
import type { Dataset, Project } from "@/lib/types";
import type { CityMeta } from "@/lib/cities";

// Leaflet touches `window` at import time, so the Map module can't be
// evaluated during SSR. Dynamic import with ssr:false skips it on the
// server, then loads on the client after hydration.
const ProjectsMap = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => null,
});

const INITIAL_FILTERS: Filters = {
  query: "",
  borough: "",
  type: "",
  minUnits: 0,
  startYear: null,
};

function initialCityFromURL(): string {
  if (typeof window === "undefined") return "nyc";
  return new URLSearchParams(window.location.search).get("city") || "nyc";
}

export default function HomePage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [cities, setCities] = useState<CityMeta[]>([]);
  const [activeCityId, setActiveCityId] = useState<string>(() => initialCityFromURL());
  const [comparing, setComparing] = useState(false);

  // Fetch cities once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cities")
      .then((r) => (r.ok ? r.json() : { cities: [] }))
      .then((d: { cities?: CityMeta[] }) => {
        if (!cancelled) setCities(d.cities ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch projects for the active city; refetches whenever the city changes.
  useEffect(() => {
    let cancelled = false;
    // Reset state on city switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDataset(null);
    setSelectedId(null);
    setFilters(INITIAL_FILTERS);

    async function load() {
      try {
        const resp = await fetch(`/api/projects?city=${activeCityId}&limit=10000`);
        if (resp.ok) {
          const data = await resp.json();
          if (cancelled) return;
          setDataset({
            source: data.city?.name ?? "API",
            sourceUrl: "",
            fetchedAt: data.city?.fetchedAt ?? new Date().toISOString(),
            projectCount: data.count,
            rawRowCount: data.count,
            projects: data.projects,
          });
          return;
        }
      } catch {
        // network error
      }
      if (activeCityId === "nyc") {
        try {
          const resp = await fetch("/nyc-housing.json");
          const data = (await resp.json()) as Dataset;
          if (!cancelled) setDataset(data);
        } catch (e) {
          if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
        }
      } else {
        if (!cancelled) setLoadError(`couldn't load ${activeCityId} from API`);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCityId]);

  // Sync activeCityId to URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (activeCityId === "nyc") sp.delete("city");
    else sp.set("city", activeCityId);
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }, [activeCityId]);

  const allProjects = useMemo(() => dataset?.projects ?? [], [dataset]);

  const filtered = useMemo(() => {
    if (!allProjects.length) return [];
    const q = filters.query.trim().toLowerCase();
    return allProjects.filter((p) => {
      if (filters.borough && p.borough !== filters.borough) return false;
      if (filters.type && p.constructionType !== filters.type) return false;
      if (filters.minUnits > 0 && p.units.total < filters.minUnits) return false;
      if (filters.startYear != null) {
        const y = p.startDate ? parseInt(p.startDate.slice(0, 4), 10) : 0;
        if (!Number.isFinite(y) || y < filters.startYear) return false;
      }
      if (q) {
        const hay = [
          p.name,
          p.address ?? "",
          p.borough ?? "",
          p.neighborhood ?? "",
          p.postcode ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allProjects, filters]);

  const selected: Project | null = useMemo(() => {
    if (!selectedId) return null;
    return allProjects.find((p) => p.id === selectedId) ?? null;
  }, [allProjects, selectedId]);

  const activeCity = useMemo(
    () => cities.find((c) => c.id === activeCityId) ?? null,
    [cities, activeCityId],
  );

  const onCityChange = useCallback((id: string) => {
    setActiveCityId(id);
    setComparing(false);
  }, []);

  return (
    <div
      className="fixed inset-0 grid"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) 360px",
        gridTemplateRows: "100vh",
      }}
    >
      <div className="relative h-full">
        <ProjectsMap
          projects={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          center={activeCity?.center ?? null}
          defaultZoom={activeCity?.defaultZoom ?? null}
        />

        {!dataset && !loadError && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[var(--text-2)] font-mono text-sm pointer-events-none"
            style={{ zIndex: 1000 }}
          >
            loading {activeCity?.name ?? activeCityId}…
          </div>
        )}
        {loadError ? (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[var(--warning)] font-mono text-xs" style={{ zIndex: 1000 }}>
            couldn&apos;t load dataset: {loadError}
          </div>
        ) : null}

        <div
          className="absolute bottom-4 left-4 pointer-events-none"
          style={{ zIndex: 1000 }}
        >
          <div
            className="text-[10px] font-mono text-[var(--text-2)] px-2 py-1 rounded"
            style={{ background: "rgba(11,15,20,0.7)" }}
          >
            click a <span className="text-[var(--accent)]">green cluster</span> to zoom in · click an
            individual <span className="text-[var(--accent)]">dot</span> to see project details
          </div>
        </div>

        <a
          href="https://github.com/c-tonneslan/groundwork"
          target="_blank"
          rel="noreferrer"
          className="absolute top-4 right-4 text-[11px] font-mono text-[var(--text-2)] hover:text-[var(--accent)]"
          style={{ zIndex: 1000 }}
        >
          source
        </a>

        {selected && !comparing ? (
          <Detail project={selected} onClose={() => setSelectedId(null)} />
        ) : null}
        {comparing ? <Compare cities={cities} onClose={() => setComparing(false)} /> : null}
      </div>

      <Sidebar
        allProjects={allProjects}
        filtered={filtered}
        filters={filters}
        onFiltersChange={setFilters}
        selectedId={selectedId}
        onSelect={setSelectedId}
        fetchedAt={dataset?.fetchedAt ?? new Date().toISOString()}
        cities={cities}
        activeCityId={activeCityId}
        onCityChange={onCityChange}
        onCompareToggle={() => setComparing((c) => !c)}
        comparing={comparing}
      />
    </div>
  );
}
