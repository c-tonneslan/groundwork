// Published affordable-housing production targets per city.
//
// Each entry cites a real, public commitment a city or state has put
// on paper. We do NOT invent or extrapolate numbers — every target
// has a sourceUrl and the source agency, and the `notes` field is
// where we record the messy parts (what does "affordable" include
// here, what's the basis for counting, what year did the plan start).
//
// To add a city: find an actual published plan, paste the number,
// link the source. If you can't find one, leave the city off — the
// UI handles that gracefully.

export type CountingBasis = "starts" | "completions" | "financed" | "mixed";

export interface HousingTarget {
  cityId: string;
  name: string;
  agency: string;
  sourceUrl: string;
  baselineYear: number;
  targetYear: number;
  targetUnits: number;
  basis: CountingBasis;
  notes: string;
}

export const targets: HousingTarget[] = [
  {
    cityId: "nyc",
    name: "Housing New York 2.0",
    agency: "NYC Department of Housing Preservation and Development",
    sourceUrl:
      "https://www.nyc.gov/site/hpd/services-and-information/housing-new-york.page",
    baselineYear: 2014,
    targetYear: 2026,
    targetUnits: 300_000,
    basis: "financed",
    notes:
      "Expanded in November 2017 from the original 200,000-unit goal. Counts both newly constructed and preserved units financed by HPD. HPD reports their own running total; the chart here is computed independently from the public HPD dataset and may differ slightly from HPD's official accounting.",
  },
  {
    cityId: "sfo",
    name: "Housing Element 6th Cycle — affordable",
    agency: "ABAG / California Dept. of Housing and Community Development",
    sourceUrl: "https://www.sf.gov/information/housing-element",
    baselineYear: 2023,
    targetYear: 2031,
    targetUnits: 46_598,
    basis: "completions",
    notes:
      "State-mandated affordable RHNA allocation for the 8-year Housing Element period 2023-2031. Affordable here means very-low, low, and moderate income (≤120% AMI). Total RHNA including market-rate is 82,069.",
  },
  {
    cityId: "lax",
    name: "Housing Element 6th Cycle — affordable",
    agency: "SCAG / California Dept. of Housing and Community Development",
    sourceUrl: "https://planning.lacity.gov/plans-policies/housing-element",
    baselineYear: 2021,
    targetYear: 2029,
    targetUnits: 184_721,
    basis: "completions",
    notes:
      "State-mandated affordable RHNA allocation for the 6th Cycle Housing Element. Includes very-low, low, and moderate income (≤120% AMI). Total RHNA including market-rate is 456,643. Open-data coverage of completions is partial — the chart is a lower bound, not an audit.",
  },
  {
    cityId: "dc",
    name: "Housing Framework for Equity and Growth",
    agency: "DC Office of the Deputy Mayor for Planning and Economic Development",
    sourceUrl:
      "https://dmped.dc.gov/page/housing-framework-equity-and-growth",
    baselineYear: 2019,
    targetYear: 2025,
    targetUnits: 12_000,
    basis: "completions",
    notes:
      "Affordable subset of the 36,000-unit overall housing goal announced by Mayor Bowser in 2019. 'Affordable' here is units at or below 80% MFI.",
  },
];

export function targetForCity(cityId: string): HousingTarget | null {
  return targets.find((t) => t.cityId === cityId) ?? null;
}
