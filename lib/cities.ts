// Shared types for the cities endpoint, used by the sidebar's switcher
// and the comparison panel.

export interface CityStats {
  projects: number;
  units: {
    total: number;
    extremelyLow: number;
    veryLow: number;
    low: number;
    moderate: number;
    middle: number;
    other: number;
  };
  construction: {
    newConstruction: number;
    preservation: number;
  };
  earliestStart: string | null;
  latestStart: string | null;
}

export interface CityMeta {
  id: string;
  name: string;
  center: [number, number];
  defaultZoom: number;
  dataSource: string | null;
  dataSourceUrl: string | null;
  fetchedAt: string | null;
  stats: CityStats | null;
}
