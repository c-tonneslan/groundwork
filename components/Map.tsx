"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import type { Project } from "@/lib/types";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// Carto's "Dark Matter" basemap is CC-licensed and served free from
// their CDN. No API key needed.
const STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const NYC_CENTER: [number, number] = [-73.9857, 40.7484];

export default function ProjectsMap({ projects, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  // Project array as GeoJSON; recomputed whenever filters change upstream.
  const geojson = useMemo(() => {
    const features = projects.map((p) => ({
      type: "Feature" as const,
      properties: {
        id: p.id,
        name: p.name,
        borough: p.borough,
        units: p.units.total,
        startDate: p.startDate,
        constructionType: p.constructionType,
        size: p.units.total > 100 ? 2 : p.units.total > 20 ? 1 : 0,
      },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [projects]);

  // One-time map init.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: NYC_CENTER,
      zoom: 10.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    // Resize observer: if the container's height was 0 at init time (e.g.
    // the parent grid hadn't laid out yet), we'd render a 0-pixel-tall map.
    // Watching for size changes lets us recover gracefully.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      map.addSource("projects", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 45,
      });

      // Cluster circles.
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "projects",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#3a9e8a",
          "circle-opacity": 0.85,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            14,
            10,
            18,
            50,
            22,
            150,
            28,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#6dd0a4",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "projects",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 11,
        },
        paint: {
          "text-color": "#0b0f14",
        },
      });

      // Unclustered points: size scales with total units, accent ring for
      // the currently-selected project (filter id is updated reactively).
      map.addLayer({
        id: "points",
        type: "circle",
        source: "projects",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#6dd0a4",
          "circle-opacity": 0.85,
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "units"],
            0,
            3.5,
            50,
            5,
            200,
            7,
            500,
            10,
            2000,
            14,
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0b0f14",
        },
      });

      // Selected-project halo. Filter rewires from outside.
      map.addLayer({
        id: "selected",
        type: "circle",
        source: "projects",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-color": "transparent",
          "circle-radius": 16,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#e8c46a",
        },
      });

      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (typeof clusterId !== "number") return;
        const source = map.getSource("projects") as GeoJSONSource;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const geom = features[0].geometry as unknown as { coordinates: [number, number] };
          map.easeTo({ center: geom.coordinates, zoom });
        });
      });

      map.on("click", "points", (e) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") onSelect(id);
      });

      for (const layer of ["clusters", "points"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is set up once; subsequent geojson/selected updates go
    // through the targeted effects below instead of re-initing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update the data source when filters change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("projects") as GeoJSONSource | undefined;
      if (source) source.setData(geojson);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [geojson]);

  // Update the selection halo + fly to the selected project.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setFilter("selected", ["==", ["get", "id"], selectedId ?? ""]);
    if (!selectedId) return;
    const project = projects.find((p) => p.id === selectedId);
    if (!project) return;
    map.easeTo({
      center: [project.lng, project.lat],
      zoom: Math.max(14, map.getZoom()),
      duration: 800,
    });
  }, [selectedId, projects]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
