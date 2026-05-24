"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Sidebar, { type Filters } from "@/components/Sidebar";
import Detail from "@/components/Detail";
import Compare from "@/components/Compare";
import Gap, { type GapTract } from "@/components/Gap";
import Trends, { type TrendYear } from "@/components/Trends";
import Progress, { type ProgressPayload } from "@/components/Progress";
import Expiring, { type ExpiringPayload } from "@/components/Expiring";
import type { Dataset, Project } from "@/lib/types";
import type { CityMeta } from "@/lib/cities";

interface TractFC {
  type: "FeatureCollection";
  features: unknown[];
}

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

function initialProjectFromURL(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("project") || null;
}

// Filter params we sync to the URL. Keep names short so the URL stays
// readable when shared.
function filtersFromURL(): Filters {
  if (typeof window === "undefined") return INITIAL_FILTERS;
  const sp = new URLSearchParams(window.location.search);
  const min = parseInt(sp.get("min") ?? "0", 10);
  const yearStr = sp.get("year");
  const year = yearStr ? parseInt(yearStr, 10) : null;
  return {
    query: sp.get("q") ?? "",
    borough: sp.get("borough") ?? "",
    type: sp.get("type") ?? "",
    minUnits: Number.isFinite(min) && min > 0 ? min : 0,
    startYear: year && Number.isFinite(year) ? year : null,
  };
}

export default function HomePage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => filtersFromURL());
  const [selectedId, setSelectedId] = useState<string | null>(() => initialProjectFromURL());

  const [cities, setCities] = useState<CityMeta[]>([]);
  const [activeCityId, setActiveCityId] = useState<string>(() => initialCityFromURL());
  const [comparing, setComparing] = useState(false);

  // Track whether we've finished the first render. URL-restored filters
  // should survive that first render, but every subsequent city switch
  // resets filters (boroughs/types differ city-to-city).
  const didMountCity = useRef(false);

  const [showBurden, setShowBurden] = useState(false);
  const [tracts, setTracts] = useState<TractFC | null>(null);
  const [gap, setGap] = useState<GapTract[] | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [showGap, setShowGap] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [trends, setTrends] = useState<TrendYear[] | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [showExpiring, setShowExpiring] = useState(false);
  const [expiring, setExpiring] = useState<ExpiringPayload | null>(null);
  const [expiringError, setExpiringError] = useState<string | null>(null);
  const [mapFlyTo, setMapFlyTo] = useState<[number, number] | null>(null);

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
    // Reset state on city switch — but not on the very first mount,
    // where filters may have been restored from the URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDataset(null);
    if (didMountCity.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(null);
    }
    if (didMountCity.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters(INITIAL_FILTERS);
    } else {
      didMountCity.current = true;
    }

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

  // Fetch tracts + gap when burden mode flips on OR city changes.
  useEffect(() => {
    if (!showBurden && !showGap) return;
    let cancelled = false;
    async function load() {
      if (showBurden) {
        try {
          const resp = await fetch(`/api/tracts?city=${activeCityId}`);
          if (resp.ok) {
            const fc = (await resp.json()) as TractFC;
            if (!cancelled) setTracts(fc);
          }
        } catch {
          /* ignore */
        }
      }
      if (showGap) {
        try {
          const resp = await fetch(`/api/gap?city=${activeCityId}&radius=1000&limit=25`);
          if (resp.ok) {
            const data = (await resp.json()) as { tracts: GapTract[] };
            if (!cancelled) {
              setGap(data.tracts);
              setGapError(null);
            }
          } else if (!cancelled) {
            setGapError(`couldn't load supply gap (${resp.status})`);
          }
        } catch (e) {
          if (!cancelled) setGapError(e instanceof Error ? e.message : "request failed");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCityId, showBurden, showGap]);

  // Fetch trends when the panel opens or the city changes.
  useEffect(() => {
    if (!showTrends) return;
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(`/api/trends?city=${activeCityId}`);
        if (resp.ok) {
          const data = (await resp.json()) as { years: TrendYear[] };
          if (!cancelled) {
            setTrends(data.years);
            setTrendsError(null);
          }
        } else if (!cancelled) {
          setTrendsError(`couldn't load trends (${resp.status})`);
        }
      } catch (e) {
        if (!cancelled) setTrendsError(e instanceof Error ? e.message : "request failed");
      }
    }
    // Clear stale chart data when the city changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrends(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrendsError(null);
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCityId, showTrends]);

  // Fetch progress-vs-target.
  useEffect(() => {
    if (!showProgress) return;
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(`/api/progress?city=${activeCityId}`);
        if (resp.ok) {
          const data = (await resp.json()) as ProgressPayload;
          if (!cancelled) {
            setProgress(data);
            setProgressError(null);
          }
        } else if (!cancelled) {
          setProgressError(`couldn't load progress vs target (${resp.status})`);
        }
      } catch (e) {
        if (!cancelled) setProgressError(e instanceof Error ? e.message : "request failed");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgressError(null);
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCityId, showProgress]);

  // Fetch affordability-expiration analysis.
  useEffect(() => {
    if (!showExpiring) return;
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(`/api/expiring?city=${activeCityId}&horizon=10`);
        if (resp.ok) {
          const data = (await resp.json()) as ExpiringPayload;
          if (!cancelled) {
            setExpiring(data);
            setExpiringError(null);
          }
        } else if (!cancelled) {
          setExpiringError(`couldn't load expiring units (${resp.status})`);
        }
      } catch (e) {
        if (!cancelled) setExpiringError(e instanceof Error ? e.message : "request failed");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpiring(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpiringError(null);
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCityId, showExpiring]);

  // Esc closes whatever overlay panel or detail card is currently up.
  // Order matches what's visually layered: the analytical panels render
  // on top of the detail card (and the detail card hides while one is
  // open), so close those first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      // Don't hijack Escape while the user's typing in the search box etc.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (comparing) { setComparing(false); return; }
      if (showGap) { setShowGap(false); return; }
      if (showTrends) { setShowTrends(false); return; }
      if (showProgress) { setShowProgress(false); return; }
      if (showExpiring) { setShowExpiring(false); return; }
      if (selectedId) { setSelectedId(null); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comparing, showGap, showTrends, showProgress, showExpiring, selectedId]);

  // Sync city + filter state to URL. We use replaceState so each
  // keystroke in the search box doesn't push a history entry.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams();
    if (activeCityId !== "nyc") sp.set("city", activeCityId);
    if (filters.query.trim()) sp.set("q", filters.query.trim());
    if (filters.borough) sp.set("borough", filters.borough);
    if (filters.type) sp.set("type", filters.type);
    if (filters.minUnits > 0) sp.set("min", String(filters.minUnits));
    if (filters.startYear != null) sp.set("year", String(filters.startYear));
    if (selectedId) sp.set("project", selectedId);
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }, [activeCityId, filters, selectedId]);

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
    <div className="fixed inset-0 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[100vh]">
      <div className="relative h-[55vh] md:h-full md:flex-none">
        <ProjectsMap
          projects={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          center={mapFlyTo ?? activeCity?.center ?? null}
          defaultZoom={activeCity?.defaultZoom ?? null}
          tracts={showBurden ? (tracts as never) : null}
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

        <div
          className="absolute top-4 right-4 flex items-center gap-4 text-[11px] font-mono text-[var(--text-2)]"
          style={{ zIndex: 1000 }}
        >
          <a href="/data-sources" className="hover:text-[var(--accent)]">
            data
          </a>
          <a
            href="https://github.com/c-tonneslan/groundwork"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--accent)]"
          >
            source
          </a>
        </div>

        {selected && !comparing && !showGap && !showTrends && !showProgress && !showExpiring ? (
          <Detail
            project={selected}
            cityId={activeCityId}
            city={activeCity}
            onClose={() => setSelectedId(null)}
            onSelect={setSelectedId}
          />
        ) : null}
        {comparing ? <Compare cities={cities} onClose={() => setComparing(false)} /> : null}
        {showGap ? (
          gap ? (
            <Gap
              cityName={activeCity?.name ?? activeCityId}
              tracts={gap}
              radiusMeters={1000}
              onClose={() => setShowGap(false)}
              onFlyTo={(lat, lng) => setMapFlyTo([lat, lng])}
            />
          ) : (
            <PanelShell title="supply gap" onClose={() => setShowGap(false)}>
              {gapError ? <PanelError message={gapError} /> : <PanelLoading />}
            </PanelShell>
          )
        ) : null}
        {showTrends ? (
          trendsError ? (
            <PanelShell title="trends" onClose={() => setShowTrends(false)}>
              <PanelError message={trendsError} />
            </PanelShell>
          ) : trends ? (
            <Trends
              cityName={activeCity?.name ?? activeCityId}
              years={trends}
              onClose={() => setShowTrends(false)}
            />
          ) : (
            <PanelShell title="trends" onClose={() => setShowTrends(false)}>
              <PanelLoading />
            </PanelShell>
          )
        ) : null}
        {showProgress ? (
          progressError ? (
            <PanelShell title="vs target" onClose={() => setShowProgress(false)}>
              <PanelError message={progressError} />
            </PanelShell>
          ) : progress ? (
            <Progress
              cityName={activeCity?.name ?? activeCityId}
              payload={progress}
              onClose={() => setShowProgress(false)}
            />
          ) : (
            <PanelShell title="vs target" onClose={() => setShowProgress(false)}>
              <PanelLoading />
            </PanelShell>
          )
        ) : null}
        {showExpiring ? (
          expiringError ? (
            <PanelShell title="expiring" onClose={() => setShowExpiring(false)}>
              <PanelError message={expiringError} />
            </PanelShell>
          ) : expiring ? (
            <Expiring
              cityName={activeCity?.name ?? activeCityId}
              payload={expiring}
              onClose={() => setShowExpiring(false)}
              onSelect={(id) => {
                setShowExpiring(false);
                setSelectedId(id);
              }}
            />
          ) : (
            <PanelShell title="expiring" onClose={() => setShowExpiring(false)}>
              <PanelLoading />
            </PanelShell>
          )
        ) : null}
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
        showBurden={showBurden}
        onToggleBurden={() => setShowBurden((b) => !b)}
        showGap={showGap}
        onToggleGap={() => setShowGap((g) => !g)}
        showTrends={showTrends}
        onToggleTrends={() => setShowTrends((t) => !t)}
        showProgress={showProgress}
        onToggleProgress={() => setShowProgress((p) => !p)}
        showExpiring={showExpiring}
        onToggleExpiring={() => setShowExpiring((e) => !e)}
      />
    </div>
  );
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-4 left-4 w-96 max-w-[calc(100%-2rem)] rounded-xl border overflow-hidden"
      style={{
        background: "rgba(17,24,31,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        zIndex: 1000,
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[10px] uppercase tracking-widest font-mono text-[var(--text-3)]">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--text-2)] hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-2)", width: "70%" }} />
      <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-2)", width: "92%" }} />
      <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-2)", width: "58%" }} />
      <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-2)", width: "82%" }} />
      <div className="text-[10px] font-mono text-[var(--text-3)] mt-2">loading…</div>
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <div className="text-[11px] text-[var(--warning,#e6b800)] font-mono leading-relaxed">
      {message}
    </div>
  );
}
