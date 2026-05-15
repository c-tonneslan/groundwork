// Shape of one aggregated affordable-housing project as written by
// scripts/fetch-nyc.mjs.

export interface Project {
  id: string;
  name: string;
  startDate: string | null;
  borough: string | null;
  address: string | null;
  postcode: string | null;
  constructionType: string | null;
  extendedAffordability: boolean;
  prevailingWage: boolean;
  councilDistrict: number | null;
  communityBoard: string | null;
  neighborhood: string | null;
  buildings: number;
  lat: number;
  lng: number;
  units: {
    total: number;
    counted: number;
    rental: number;
    homeownership: number;
    extremelyLowIncome: number;
    veryLowIncome: number;
    lowIncome: number;
    moderateIncome: number;
    middleIncome: number;
    otherIncome: number;
    studio: number;
    oneBR: number;
    twoBR: number;
    threeBR: number;
    fourPlusBR: number;
  };
}

export interface Dataset {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  projectCount: number;
  rawRowCount: number;
  projects: Project[];
}
