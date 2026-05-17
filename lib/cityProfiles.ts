// Per-city display profile. Things that vary between cities but aren't
// in the database: which agency runs the program, what to call the
// "borough" field locally, whether the agency publishes a general
// inquiry email. When adding a city, append a profile here.

export interface CityProfile {
  // Short agency name shown above the project title, e.g. "HPD", "MOHCD".
  agencyAbbr: string;
  // Used in the "Contact X" button label.
  agencyShortName: string;
  // Public general-inquiry email. Leave null if the agency only
  // publishes a contact form; the contact button is hidden in that case.
  contactEmail: string | null;
  // What this city calls the borough/district/area field. Used in the
  // sidebar's filter ("all boroughs" vs "all districts" vs "all areas").
  regionLabel: string;
}

export const CITY_PROFILES: Record<string, CityProfile> = {
  nyc: {
    agencyAbbr: "HPD",
    agencyShortName: "HPD",
    contactEmail: "contact@hpd.nyc.gov",
    regionLabel: "borough",
  },
  sfo: {
    agencyAbbr: "MOHCD",
    agencyShortName: "MOHCD",
    contactEmail: null,
    regionLabel: "neighborhood",
  },
  lax: {
    agencyAbbr: "LAHD",
    agencyShortName: "LAHD",
    contactEmail: null,
    regionLabel: "area",
  },
  chi: {
    agencyAbbr: "DOH",
    agencyShortName: "Housing Dept",
    contactEmail: null,
    regionLabel: "ward",
  },
  dc: {
    agencyAbbr: "DHCD",
    agencyShortName: "DHCD",
    contactEmail: "dhcd@dc.gov",
    regionLabel: "ward",
  },
  phl: {
    agencyAbbr: "DHCD",
    agencyShortName: "DHCD",
    contactEmail: null,
    regionLabel: "district",
  },
  bos: {
    agencyAbbr: "DND",
    agencyShortName: "Boston DND",
    contactEmail: null,
    regionLabel: "neighborhood",
  },
  sea: {
    agencyAbbr: "OH",
    agencyShortName: "Office of Housing",
    contactEmail: null,
    regionLabel: "district",
  },
  aus: {
    agencyAbbr: "NHCD",
    agencyShortName: "Austin NHCD",
    contactEmail: null,
    regionLabel: "district",
  },
};

export function profileFor(cityId: string): CityProfile {
  return CITY_PROFILES[cityId] ?? FALLBACK_PROFILE;
}

const FALLBACK_PROFILE: CityProfile = {
  agencyAbbr: "Project",
  agencyShortName: "city",
  contactEmail: null,
  regionLabel: "area",
};
