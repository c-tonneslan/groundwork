// Pure, testable core for /api/ask (natural-language search + grounded Q&A).
//
// Everything here is deterministic given the model's raw text output — no
// network, no DB, no clock (the caller passes maxYear). That's what lets the
// eval harness and unit tests exercise the translation without an API key.

export interface AskFilters {
  query: string;
  borough: string;
  type: string;
  minUnits: number;
  startYear: number | null;
}

// Aggregate questions the model may ask us to compute. Each maps to a fixed,
// parameterized SQL shape below — the model never writes SQL, it only picks a
// metric + a filter scope.
export type AnswerMetric = "count" | "total_units" | "units_by_tier" | "date_range";
export const ANSWER_METRICS: AnswerMetric[] = ["count", "total_units", "units_by_tier", "date_range"];

export type AskResult =
  | { kind: "filter"; filters: AskFilters; interpretation: string }
  | { kind: "answer"; metric: AnswerMetric; filters: AskFilters; interpretation: string }
  | { kind: "refuse"; refusal: string };

export const EMPTY_FILTERS: AskFilters = {
  query: "",
  borough: "",
  type: "",
  minUnits: 0,
  startYear: null,
};

export function buildSystemPrompt(regionLabel: string, boroughs: string[], types: string[]): string {
  return `You turn a plain-English question about affordable-housing projects into a JSON command. There are three intents:

1. "filter" — narrow the map/list. Fields:
   - query: free text matched against name/address/neighborhood (string, or "")
   - borough: the local "${regionLabel}" field. MUST be exactly one of ${JSON.stringify(boroughs)} — or "" for any.
   - type: construction type. MUST be exactly one of ${JSON.stringify(types)} — or "" for any.
   - minUnits: integer >= 0 (0 = no minimum)
   - startYear: 4-digit integer (projects started in or after it), or null
2. "answer" — compute a single number over a filter scope. Pick a metric:
   - "count" (how many projects), "total_units" (sum of units), "units_by_tier" (units broken down by income tier), "date_range" (earliest/latest start year). Also include the same "filters" object to scope it.
3. "refuse" — the question needs something these fields can't express (transit/subway proximity, rent burden, bedroom mix, price/cheapest, distance). Do NOT invent a filter; explain briefly what you can't do.

Rules: match borough/type case-insensitively to the CLOSEST allowed value; never output a value not in the allowed lists. "large"/"big" -> minUnits ~100. "family-sized" means bedroom counts (unsupported -> refuse).

Respond with ONLY one JSON object, no prose or markdown:
{"intent":"filter","filters":{"query":"","borough":"","type":"","minUnits":0,"startYear":null},"interpretation":"short summary"}
{"intent":"answer","metric":"count","filters":{...},"interpretation":"short summary of what is being counted"}
{"intent":"refuse","refusal":"one short sentence"}`;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no json object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

// Whitelist a raw filter object against the real vocabulary. Anything the model
// invented (a borough/type that doesn't exist, an absurd year) is dropped.
export function validateFilters(
  raw: unknown,
  boroughs: string[],
  types: string[],
  maxYear: number,
): AskFilters {
  const f = (raw ?? {}) as Record<string, unknown>;
  const borough = typeof f.borough === "string" && boroughs.includes(f.borough) ? f.borough : "";
  const type = typeof f.type === "string" && types.includes(f.type) ? f.type : "";
  const minUnitsRaw = Number(f.minUnits);
  const minUnits = Number.isFinite(minUnitsRaw) ? Math.max(0, Math.min(100000, Math.round(minUnitsRaw))) : 0;
  const yearRaw = Number(f.startYear);
  const startYear =
    f.startYear != null && Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= maxYear
      ? Math.round(yearRaw)
      : null;
  const query = typeof f.query === "string" ? f.query.trim().slice(0, 200) : "";
  return { query, borough, type, minUnits, startYear };
}

// Interpret the model's raw text into a validated, typed result. Never throws.
export function interpretModelOutput(
  rawText: string,
  opts: { boroughs: string[]; types: string[]; maxYear: number },
): AskResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(rawText) as Record<string, unknown>;
  } catch {
    return { kind: "refuse", refusal: "I couldn't interpret that question." };
  }

  const intent = typeof parsed.intent === "string" ? parsed.intent : "";

  if (intent === "refuse" || (!parsed.filters && !parsed.metric)) {
    const refusal = typeof parsed.refusal === "string" ? parsed.refusal : "That can't be answered with the available data.";
    return { kind: "refuse", refusal: refusal.slice(0, 240) };
  }

  const filters = validateFilters(parsed.filters, opts.boroughs, opts.types, opts.maxYear);
  const interpretation = (typeof parsed.interpretation === "string" ? parsed.interpretation : "").slice(0, 240);

  if (intent === "answer") {
    const metric = ANSWER_METRICS.includes(parsed.metric as AnswerMetric)
      ? (parsed.metric as AnswerMetric)
      : "count";
    return { kind: "answer", metric, filters, interpretation: interpretation || "Computing an answer." };
  }

  return { kind: "filter", filters, interpretation: interpretation || "Filter applied." };
}

// --- deterministic parser -------------------------------------------------
// A fast, zero-cost, offline first pass. It handles the common shapes (a
// borough name, "new construction", "since 2020", "over 100 units", "how many
// units in X") without any model call. Returns null when it isn't confident, so
// the caller can escalate to the LLM (or, with no key, show a hint). Being a
// pure function, it's unit-tested alongside the model path.

const REFUSE_PATTERNS: [RegExp, string][] = [
  [/\b(subway|transit|train|metro|bus|station|commute)\b/, "I can't filter by transit or subway proximity — try a borough or project size."],
  [/\b(closest|nearest)\b|\bnear (the |a )?(subway|station|downtown|park|water|transit)\b|\bwithin\b.{0,15}\b(mile|minute|km|block)/, "I can't do distance or proximity filters — try filtering by borough."],
  [/rent[- ]?burden|burdened|displacement|evict|gentrif/, "Rent burden and displacement aren't project filters — see the rent-burden layer and the supply-demand gap panel."],
  [/\bbedroom|\b\d\s?br\b|\bstudio\b|family[- ]?sized/, "I can't filter by bedroom mix or unit size."],
  [/\bcheap|\bprice|\bcost\b|how much|\bexpir|at risk/, "I can't filter by price or expiring affordability."],
];

function matchBorough(lower: string, boroughs: string[]): string {
  let best = "";
  for (const b of boroughs) {
    const bl = b.toLowerCase();
    if (lower.includes(bl) && bl.length > best.length) best = b;
  }
  return best;
}

function matchType(lower: string, types: string[]): string {
  for (const t of types) {
    const tl = t.toLowerCase();
    if (tl.includes("new") && /\bnew\b/.test(lower) && /(construction|build|development)/.test(lower)) return t;
    if (tl.includes("preserv") && /preserv|rehab|renovat/.test(lower)) return t;
  }
  for (const t of types) if (lower.includes(t.toLowerCase())) return t;
  return "";
}

function matchMinUnits(lower: string): number {
  const m =
    lower.match(/(?:over|at least|more than|minimum(?: of)?|min|>=?)\s*([\d,]+)\s*units?/) ??
    lower.match(/([\d,]+)\s*\+?\s*units?\s*(?:or more|and up|\+|or larger)/) ??
    lower.match(/([\d,]+)\+\s*units?/);
  if (m) return Math.max(0, Math.min(100000, parseInt(m[1].replace(/,/g, ""), 10) || 0));
  if (/\b(large|big|major|sizable|substantial|huge)\b/.test(lower)) return 100;
  return 0;
}

function matchYear(lower: string, maxYear: number): number | null {
  let y: number | null = null;
  const m = lower.match(/(?:since|after|from|starting(?: in)?|newer than|>=?)\s*((?:19|20)\d{2})/);
  if (m) y = parseInt(m[1], 10);
  if (y == null) {
    const m2 = lower.match(/\b((?:19|20)\d{2})\b/);
    if (m2 && /since|after|from|newer|recent|past|last/.test(lower)) y = parseInt(m2[1], 10);
  }
  if (y != null && (y < 1900 || y > maxYear)) y = null;
  return y;
}

function matchMetric(lower: string): AnswerMetric | null {
  if (/(how many|number of|total|sum of|count of).{0,20}units|units.{0,10}(total|count)/.test(lower)) return "total_units";
  if (/income tier|by tier|ami breakdown|affordability breakdown|breakdown by income/.test(lower)) return "units_by_tier";
  if (/what years|date range|years.{0,10}span|span.{0,10}years|oldest|newest|earliest|latest|when were|time range/.test(lower)) return "date_range";
  if (/how many (projects|developments|buildings)|number of (projects|developments)|count of|how many are there/.test(lower)) return "count";
  return null;
}

function describeScope(f: AskFilters): string {
  const parts: string[] = [];
  if (f.type) parts.push(f.type);
  if (f.minUnits > 0) parts.push(`≥${f.minUnits.toLocaleString()} units`);
  if (f.borough) parts.push(f.borough);
  if (f.startYear != null) parts.push(`since ${f.startYear}`);
  return parts.join(" · ") || "all projects";
}

export function heuristicParse(
  question: string,
  opts: { boroughs: string[]; types: string[]; maxYear: number },
): AskResult | null {
  const lower = question.toLowerCase();
  for (const [re, msg] of REFUSE_PATTERNS) if (re.test(lower)) return { kind: "refuse", refusal: msg };

  const filters: AskFilters = {
    query: "",
    borough: matchBorough(lower, opts.boroughs),
    type: matchType(lower, opts.types),
    minUnits: matchMinUnits(lower),
    startYear: matchYear(lower, opts.maxYear),
  };
  const metric = matchMetric(lower);
  if (metric) {
    const label = { count: "Projects", total_units: "Total units", units_by_tier: "Units by income tier", date_range: "Date range" }[metric];
    return { kind: "answer", metric, filters, interpretation: `${label} · ${describeScope(filters)}` };
  }

  const hasScope = !!filters.borough || !!filters.type || filters.minUnits > 0 || filters.startYear != null;
  if (hasScope) return { kind: "filter", filters, interpretation: describeScope(filters) };

  return null;
}

// --- cross-city place resolution ------------------------------------------
// A question can name a place that lives in a different city than the one on
// screen ("how many units in Brooklyn" while viewing Philadelphia). This maps
// the named place to its city so the caller can switch to it before answering,
// instead of silently using the active city. Only cities that are actually
// loaded (availableCityIds) are eligible.

interface CityKeyword {
  city: string;
  aliases: string[];
  // cross-city boroughs -> the canonical borough value stored in the data.
  boroughs?: Record<string, string>;
}

const CITY_KEYWORDS: CityKeyword[] = [
  {
    city: "nyc",
    aliases: ["new york city", "new york", "nyc"],
    boroughs: { brooklyn: "Brooklyn", manhattan: "Manhattan", queens: "Queens", bronx: "Bronx", "staten island": "Staten Island" },
  },
  { city: "phl", aliases: ["philadelphia", "philly", "phila"] },
  { city: "sfo", aliases: ["san francisco", "sf"] },
  { city: "lax", aliases: ["los angeles"] },
  { city: "dc", aliases: ["washington dc", "washington", "d.c."] },
  { city: "chi", aliases: ["chicago"] },
  { city: "bos", aliases: ["boston"] },
  { city: "sea", aliases: ["seattle"] },
  { city: "aus", aliases: ["austin"] },
];

function wordMatch(lower: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(lower);
}

export function resolveCity(
  question: string,
  availableCityIds: string[],
  activeCity: string,
): { city: string; borough: string } {
  const lower = question.toLowerCase();
  const avail = new Set(availableCityIds);

  // Boroughs first (most specific); longest alias wins.
  let bestB: { city: string; borough: string; len: number } | null = null;
  for (const k of CITY_KEYWORDS) {
    if (!avail.has(k.city) || !k.boroughs) continue;
    for (const [alias, canon] of Object.entries(k.boroughs)) {
      if (wordMatch(lower, alias) && (!bestB || alias.length > bestB.len)) bestB = { city: k.city, borough: canon, len: alias.length };
    }
  }
  if (bestB) return { city: bestB.city, borough: bestB.borough };

  // Then city names.
  let bestC: { city: string; len: number } | null = null;
  for (const k of CITY_KEYWORDS) {
    if (!avail.has(k.city)) continue;
    for (const alias of k.aliases) {
      if (wordMatch(lower, alias) && (!bestC || alias.length > bestC.len)) bestC = { city: k.city, len: alias.length };
    }
  }
  if (bestC) return { city: bestC.city, borough: "" };

  return { city: activeCity, borough: "" };
}

// Build the parameterized WHERE clauses for a validated filter, mirroring
// /api/projects exactly. Caller supplies city as $1; filters start at
// `startIndex`. Returns clause fragments (joined with AND by the caller) and
// the bound params (in order, after the city param).
export function buildProjectWhere(
  filters: AskFilters,
  startIndex: number,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  if (filters.borough) {
    clauses.push(`p.borough = $${i++}`);
    params.push(filters.borough);
  }
  if (filters.type) {
    clauses.push(`p.construction_type = $${i++}`);
    params.push(filters.type);
  }
  if (filters.query) {
    const esc = filters.query.replace(/[\\%_]/g, (c) => `\\${c}`);
    clauses.push(
      `(p.name ILIKE $${i} OR p.address ILIKE $${i} OR p.neighborhood ILIKE $${i} OR p.postcode ILIKE $${i})`,
    );
    params.push(`%${esc}%`);
    i += 1;
  }
  if (filters.minUnits > 0) {
    clauses.push(`p.units_total >= $${i++}`);
    params.push(filters.minUnits);
  }
  if (filters.startYear != null) {
    // Fall back to completion date: some cities (e.g. Philadelphia) only
    // publish completion dates, so filtering on start_date alone drops them all.
    clauses.push(`EXTRACT(YEAR FROM COALESCE(p.start_date, p.completion_date))::int >= $${i++}`);
    params.push(filters.startYear);
  }
  return { clauses, params };
}
