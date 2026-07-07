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
    clauses.push(`EXTRACT(YEAR FROM p.start_date)::int >= $${i++}`);
    params.push(filters.startYear);
  }
  return { clauses, params };
}
