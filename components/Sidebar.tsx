"use client";

import { useMemo } from "react";
import { Search, X, MapPin, Building2, Columns3, Layers, Scale, TrendingUp, Target } from "lucide-react";
import type { Project } from "@/lib/types";
import type { CityMeta } from "@/lib/cities";

export interface Filters {
  query: string;
  borough: string;
  type: string;
  minUnits: number;
  startYear: number | null;
}

interface Props {
  allProjects: Project[];
  filtered: Project[];
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  fetchedAt: string;
  // Multi-city support. When `cities.length > 1` we render a switcher
  // and a Compare button at the top.
  cities: CityMeta[];
  activeCityId: string;
  onCityChange: (id: string) => void;
  onCompareToggle: () => void;
  comparing: boolean;
  // Phase 3: census-burden choropleth + supply-demand gap panel.
  showBurden: boolean;
  onToggleBurden: () => void;
  showGap: boolean;
  onToggleGap: () => void;
  // Phase 5: production-over-time chart.
  showTrends: boolean;
  onToggleTrends: () => void;
  // Phase 6: production vs published target.
  showProgress: boolean;
  onToggleProgress: () => void;
}

export default function Sidebar({
  allProjects,
  filtered,
  filters,
  onFiltersChange,
  selectedId,
  onSelect,
  fetchedAt,
  cities,
  activeCityId,
  onCityChange,
  onCompareToggle,
  comparing,
  showBurden,
  onToggleBurden,
  showGap,
  onToggleGap,
  showTrends,
  onToggleTrends,
  showProgress,
  onToggleProgress,
}: Props) {
  const activeCity = cities.find((c) => c.id === activeCityId);
  const boroughs = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProjects) if (p.borough) set.add(p.borough);
    return Array.from(set).sort();
  }, [allProjects]);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProjects) if (p.constructionType) set.add(p.constructionType);
    return Array.from(set).sort();
  }, [allProjects]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const p of allProjects) {
      if (!p.startDate) continue;
      const y = parseInt(p.startDate.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [allProjects]);

  const hasFilter =
    filters.query !== "" ||
    filters.borough !== "" ||
    filters.type !== "" ||
    filters.minUnits > 0 ||
    filters.startYear !== null;

  return (
    <aside
      className="flex flex-col h-full overflow-hidden border-l"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface)",
      }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-baseline justify-between">
          <span className="font-mono tracking-wider text-[var(--accent)]" style={{ fontSize: "0.95rem" }}>
            groundwork
          </span>
          <span className="text-[10px] text-[var(--text-3)] font-mono">
            data {new Date(fetchedAt).toISOString().slice(0, 10)}
          </span>
        </div>

        {/* City switcher + compare. Only renders when we have >1 city. */}
        {cities.length > 1 ? (
          <div className="mt-2.5 flex gap-2">
            <select
              value={activeCityId}
              onChange={(e) => onCityChange(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-md text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--accent)",
                color: "var(--accent)",
              }}
              title="Switch city"
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.stats ? ` (${c.stats.projects.toLocaleString()})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onCompareToggle}
              className="px-2.5 py-1.5 rounded-md text-xs flex items-center gap-1.5"
              style={{
                background: comparing ? "var(--accent)" : "var(--surface-2)",
                border: `1px solid ${comparing ? "var(--accent)" : "var(--border)"}`,
                color: comparing ? "var(--bg)" : "var(--text-2)",
              }}
              title="Compare cities side-by-side"
            >
              <Columns3 size={12} />
              <span>{comparing ? "hide" : "compare"}</span>
            </button>
          </div>
        ) : null}

        <div className="text-[11px] text-[var(--text-2)] mt-2">
          {filtered.length.toLocaleString()}
          {hasFilter ? <span className="text-[var(--text-3)]"> of {allProjects.length.toLocaleString()}</span> : ""}
          {" "}
          {activeCity ? `${activeCity.name} ` : ""}projects
        </div>

        {/* Analytical toggles: burden, supply gap, trends, vs target. */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <ToggleButton
            active={showBurden}
            onClick={onToggleBurden}
            icon={<Layers size={11} />}
            label="rent burden"
          />
          <ToggleButton
            active={showGap}
            onClick={onToggleGap}
            icon={<Scale size={11} />}
            label="supply gap"
          />
          <ToggleButton
            active={showTrends}
            onClick={onToggleTrends}
            icon={<TrendingUp size={11} />}
            label="trends"
          />
          <ToggleButton
            active={showProgress}
            onClick={onToggleProgress}
            icon={<Target size={11} />}
            label="vs target"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 flex flex-col gap-2.5 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            placeholder="search project, address, neighborhood"
            value={filters.query}
            onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
            className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs focus:outline-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={filters.borough}
            onChange={(e) => onFiltersChange({ ...filters, borough: e.target.value })}
            className="px-2 py-1.5 rounded-md text-xs"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${filters.borough ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)",
            }}
          >
            <option value="">all boroughs</option>
            {boroughs.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
            className="px-2 py-1.5 rounded-md text-xs"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${filters.type ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)",
            }}
          >
            <option value="">all types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={filters.startYear ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                startYear: e.target.value ? parseInt(e.target.value, 10) : null,
              })
            }
            className="px-2 py-1.5 rounded-md text-xs"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${filters.startYear ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)",
            }}
          >
            <option value="">any start year</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y} or later
              </option>
            ))}
          </select>
          <select
            value={filters.minUnits}
            onChange={(e) => onFiltersChange({ ...filters, minUnits: parseInt(e.target.value, 10) || 0 })}
            className="px-2 py-1.5 rounded-md text-xs"
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${filters.minUnits > 0 ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)",
            }}
          >
            <option value={0}>any size</option>
            <option value={20}>20+ units</option>
            <option value={100}>100+ units</option>
            <option value={300}>300+ units</option>
            <option value={1000}>1,000+ units</option>
          </select>
        </div>

        {hasFilter && (
          <button
            type="button"
            onClick={() =>
              onFiltersChange({ query: "", borough: "", type: "", minUnits: 0, startYear: null })
            }
            className="self-start flex items-center gap-1 text-[10px] text-[var(--text-2)] hover:text-[var(--accent)]"
          >
            <X size={10} /> clear filters
          </button>
        )}
      </div>

      {/* List */}
      {/* Helper toggle component for the rent-burden / supply-gap header buttons. */}
      {/* (defined below as ToggleButton) */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-[var(--text-3)] text-xs">No projects match those filters.</div>
        ) : (
          <ul>
            {filtered.slice(0, 500).map((p) => (
              <li
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="px-4 py-2.5 cursor-pointer border-b transition-colors"
                style={{
                  borderColor: "var(--surface-2)",
                  background: p.id === selectedId ? "var(--surface-2)" : "transparent",
                }}
              >
                <div
                  className="text-xs font-semibold truncate"
                  style={{ color: p.id === selectedId ? "var(--accent)" : "var(--text)" }}
                >
                  {p.name}
                </div>
                <div className="text-[10px] text-[var(--text-2)] font-mono truncate mt-0.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={10} className="text-[var(--text-3)]" />
                    {p.borough ?? "?"}
                    {p.neighborhood ? ` · ${p.neighborhood}` : ""}
                  </span>
                  <span className="text-[var(--text-3)]">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 size={10} className="text-[var(--text-3)]" />
                    {p.units.total.toLocaleString()} units
                  </span>
                </div>
                {p.startDate ? (
                  <div className="text-[10px] text-[var(--text-3)] font-mono mt-0.5">
                    started {p.startDate.slice(0, 7)}
                    {p.constructionType ? ` · ${p.constructionType.toLowerCase()}` : ""}
                  </div>
                ) : null}
              </li>
            ))}
            {filtered.length > 500 ? (
              <li className="px-4 py-3 text-[10px] text-[var(--text-3)] font-mono">
                showing 500 of {filtered.length}. narrow your filters to see the rest.
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-2 py-1.5 rounded-md text-[10px] uppercase tracking-wider font-mono flex items-center justify-center gap-1.5 transition-colors"
      style={{
        background: active ? "var(--accent)" : "var(--surface-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "var(--bg)" : "var(--text-2)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
