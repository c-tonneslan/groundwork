"use client";

import { useEffect, useMemo, useState } from "react";
import ProjectsMap from "@/components/Map";
import Sidebar, { type Filters } from "@/components/Sidebar";
import Detail from "@/components/Detail";
import type { Dataset, Project } from "@/lib/types";

const INITIAL_FILTERS: Filters = {
  query: "",
  borough: "",
  type: "",
  minUnits: 0,
  startYear: null,
};

export default function HomePage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/nyc-housing.json")
      .then((r) => r.json())
      .then((d: Dataset) => {
        if (!cancelled) setDataset(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div
      className="fixed inset-0 grid"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) 360px",
        gridTemplateRows: "100vh",
      }}
    >
      <div className="relative h-full">
        <ProjectsMap projects={filtered} selectedId={selectedId} onSelect={setSelectedId} />

        {!dataset && !loadError && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[var(--text-2)] font-mono text-sm pointer-events-none"
          >
            loading {3707} projects…
          </div>
        )}
        {loadError ? (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[var(--warning)] font-mono text-xs">
            couldn&apos;t load dataset: {loadError}
          </div>
        ) : null}

        <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
          <div className="text-[10px] font-mono text-[var(--text-3)]">
            click cluster to zoom · click marker for details
          </div>
        </div>

        <a
          href="https://github.com/c-tonneslan/groundwork"
          target="_blank"
          rel="noreferrer"
          className="absolute top-4 right-4 z-10 text-[11px] font-mono text-[var(--text-2)] hover:text-[var(--accent)]"
        >
          source
        </a>

        {selected ? <Detail project={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>

      <Sidebar
        allProjects={allProjects}
        filtered={filtered}
        filters={filters}
        onFiltersChange={setFilters}
        selectedId={selectedId}
        onSelect={setSelectedId}
        fetchedAt={dataset?.fetchedAt ?? new Date().toISOString()}
      />
    </div>
  );
}
