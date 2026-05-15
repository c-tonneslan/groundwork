"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { Project } from "@/lib/types";

// Subset of GeoJSON we actually consume. Avoids pulling in @types/geojson.
interface TractFeature {
  type: "Feature";
  id?: string;
  properties: {
    geoid: string;
    name: string | null;
    population: number | null;
    medianIncome: number | null;
    renterHouseholds: number | null;
    rentBurdened: number | null;
    severelyRentBurdened: number | null;
    rentBurdenedPct: number | null;
    severelyBurdenedPct: number | null;
  };
  geometry: {
    type: "MultiPolygon" | "Polygon";
    coordinates: number[][][] | number[][][][];
  };
}

interface TractFC {
  type: "FeatureCollection";
  features: TractFeature[];
}

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  center?: [number, number] | null;
  defaultZoom?: number | null;
  // Census tract choropleth. Pass null to hide.
  tracts?: TractFC | null;
}

const DEFAULT_CENTER: [number, number] = [40.7484, -73.9857];
const DEFAULT_ZOOM = 11;

// Carto's "Dark Matter" raster tiles. CC-BY-licensed, no API key.
// Plain image tiles — no WebGL, no workers, no eval, works under any CSP.
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function radiusFor(units: number): number {
  if (units >= 1000) return 11;
  if (units >= 300) return 9;
  if (units >= 100) return 7;
  if (units >= 30) return 5;
  return 4;
}

function makeMarker(project: Project, onSelect: (id: string) => void): L.CircleMarker {
  const marker = L.circleMarker([project.lat, project.lng], {
    radius: radiusFor(project.units.total),
    color: "#0b0f14",
    weight: 1,
    fillColor: "#6dd0a4",
    fillOpacity: 0.9,
    // Slightly larger hit area than the visible dot so clicks land easily.
    bubblingMouseEvents: false,
    interactive: true,
  });
  marker.bindTooltip(
    `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#e6edf3;">
       <div style="color:#6dd0a4;font-weight:700;">${escapeHtml(project.name)}</div>
       <div style="color:#98a8b8;font-size:10px;">${escapeHtml(project.borough ?? "")} · ${project.units.total} units · click for details</div>
     </div>`,
    { className: "gw-tooltip", direction: "top", offset: [0, -6], interactive: false },
  );
  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    onSelect(project.id);
  });
  return marker;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ClusterableLayer extends L.FeatureGroup {
  clearLayers(): this;
  addLayers(layers: L.Layer[]): this;
}

// Color ramp for rent-burden choropleth. Low burden = nearly transparent
// blue-grey, high burden = saturated warm. Tuned for the dark basemap.
function burdenColor(pct: number | null): string {
  if (pct == null) return "rgba(35,49,64,0.0)";
  // Stops at 30/40/50/60/70/80+
  if (pct >= 70) return "rgba(232,87,68,0.55)";
  if (pct >= 60) return "rgba(232,127,68,0.5)";
  if (pct >= 50) return "rgba(232,170,68,0.45)";
  if (pct >= 40) return "rgba(232,200,68,0.4)";
  if (pct >= 30) return "rgba(190,200,120,0.35)";
  return "rgba(120,160,180,0.18)";
}

export default function ProjectsMap({
  projects,
  selectedId,
  onSelect,
  center,
  defaultZoom,
  tracts,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<ClusterableLayer | null>(null);
  const markerByIdRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const haloRef = useRef<L.CircleMarker | null>(null);
  const tractLayerRef = useRef<L.GeoJSON | null>(null);

  // One-time map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: center ?? DEFAULT_CENTER,
      zoom: defaultZoom ?? DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true, // canvas renderer = better perf for thousands of markers
    });
    mapRef.current = map;

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // leaflet.markercluster augments L with `markerClusterGroup` at runtime.
    // Cast through unknown since the bundled types don't merge cleanly.
    const cluster = (
      L as unknown as { markerClusterGroup: (opts: object) => ClusterableLayer }
    ).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 35,
      // Once you've zoomed in past 13, every marker shows individually
      // so users always reach a clickable project after a reasonable zoom.
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: true,
      spiderfyOnEveryZoom: false,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (c: L.MarkerCluster) => {
        const n = c.getChildCount();
        const size = n < 10 ? 30 : n < 50 ? 36 : n < 200 ? 42 : 48;
        return L.divIcon({
          html: `<div class="gw-cluster">${n}</div>`,
          className: "",
          iconSize: [size, size],
        });
      },
    });
    cluster.addTo(map);
    clusterRef.current = cluster;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markerByIdRef.current.clear();
      haloRef.current = null;
      tractLayerRef.current = null;
    };
    // Map should init exactly once. Subsequent center/zoom changes
    // are handled by the flyTo effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Census tract choropleth: render below the markers (lower z-index pane).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove the old layer when tracts change (or get nulled out).
    if (tractLayerRef.current) {
      tractLayerRef.current.remove();
      tractLayerRef.current = null;
    }
    if (!tracts || !tracts.features.length) return;

    // Use a dedicated pane so the choropleth always sits beneath the
    // markers and clusters, regardless of when each layer mounts.
    if (!map.getPane("tracts")) {
      const pane = map.createPane("tracts");
      pane.style.zIndex = "350"; // between tilePane (200) and overlayPane (400)
      pane.style.pointerEvents = "auto";
    }

    const layer = L.geoJSON(tracts as unknown as GeoJSON.GeoJsonObject, {
      pane: "tracts",
      style: (feat) => {
        const p = (feat?.properties ?? {}) as TractFeature["properties"];
        return {
          stroke: true,
          color: "rgba(35,49,64,0.6)",
          weight: 0.5,
          fillColor: burdenColor(p.rentBurdenedPct),
          fillOpacity: 1,
        };
      },
      onEachFeature: (feat, lyr) => {
        const p = feat.properties as TractFeature["properties"];
        const pct = p.rentBurdenedPct ?? null;
        const inc = p.medianIncome;
        lyr.bindTooltip(
          `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#e6edf3;">
             <div style="color:#6dd0a4;font-weight:700;">Tract ${escapeHtml(p.name ?? p.geoid)}</div>
             <div>${pct == null ? "—" : pct.toFixed(1) + "% rent-burdened"}</div>
             <div style="color:#98a8b8;font-size:10px;">${inc ? "median income $" + inc.toLocaleString() : ""}</div>
           </div>`,
          { className: "gw-tooltip", direction: "top", sticky: true, interactive: false },
        );
      },
    });
    layer.addTo(map);
    tractLayerRef.current = layer;
  }, [tracts]);

  // Fly to a new city's center when the parent switches city.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.flyTo(center, defaultZoom ?? DEFAULT_ZOOM, { duration: 1.2 });
  }, [center, defaultZoom]);

  // Rebuild markers whenever the filtered project list changes.
  const layers = useMemo(() => {
    const map = new Map<string, L.CircleMarker>();
    const arr: L.CircleMarker[] = [];
    for (const p of projects) {
      const m = makeMarker(p, (id) => onSelect(id));
      map.set(p.id, m);
      arr.push(m);
    }
    return { map, arr };
  }, [projects, onSelect]);

  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    cluster.addLayers(layers.arr);
    markerByIdRef.current = layers.map;
  }, [layers]);

  // Selected-project halo: a larger ring around the active marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (haloRef.current) {
      haloRef.current.remove();
      haloRef.current = null;
    }

    if (!selectedId) return;
    const target = projects.find((p) => p.id === selectedId);
    if (!target) return;

    const halo = L.circleMarker([target.lat, target.lng], {
      radius: 18,
      color: "#e8c46a",
      weight: 2.5,
      fill: false,
    }).addTo(map);
    haloRef.current = halo;

    map.flyTo([target.lat, target.lng], Math.max(15, map.getZoom()), { duration: 0.8 });
  }, [selectedId, projects]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" style={{ background: "#0b0f14" }} />
      <style jsx global>{`
        .leaflet-container {
          background: #0b0f14;
          font-family: var(--font-sans, system-ui), system-ui, sans-serif;
        }
        .leaflet-control-attribution {
          background: rgba(11, 15, 20, 0.7) !important;
          color: #5a6a7a !important;
          font-size: 9px !important;
        }
        .leaflet-control-attribution a {
          color: #98a8b8 !important;
        }
        .leaflet-control-zoom a {
          background: rgba(17, 24, 31, 0.92) !important;
          border-color: #233140 !important;
          color: #98a8b8 !important;
        }
        .leaflet-control-zoom a:hover {
          background: rgba(26, 35, 44, 1) !important;
          color: #e6edf3 !important;
        }
        .gw-tooltip {
          background: #11181f !important;
          border: 1px solid #233140 !important;
          color: #e6edf3 !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
          padding: 6px 10px !important;
        }
        .gw-tooltip::before {
          border-top-color: #11181f !important;
        }
        .gw-cluster {
          background: #3a9e8a;
          color: #0b0f14;
          font-weight: 700;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 1.5px solid #6dd0a4;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }
      `}</style>
    </>
  );
}
