// POST /api/ask
//
// Natural-language search + grounded Q&A with a two-stage router:
//   1. A deterministic parser (lib/ask heuristicParse) handles the common
//      shapes offline — zero cost, zero latency, works with NO API key.
//   2. Anything it isn't confident about escalates to the LLM (if a key is set),
//      which maps the question onto the same intents. Most queries never reach
//      the model, so the paid path is the exception, not the rule.
//
// Either way the model/parser never writes SQL: it picks a filter (whitelisted
// here) or an answer metric that runs as a fixed parameterized aggregate.
//
// Hardening: per-IP rate limit + a short-TTL response cache keyed on the
// question. Both are in-memory (per serverless instance); swap for Upstash if
// you need cross-instance limits.

import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db";
import {
  buildSystemPrompt,
  heuristicParse,
  interpretModelOutput,
  buildProjectWhere,
  type AskResult,
  type AskFilters,
  type AnswerMetric,
} from "@/lib/ask";

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

// --- in-memory rate limit + cache (per serverless instance) ----------------
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
const rl = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string, now: number): boolean {
  const e = rl.get(ip);
  if (!e || now > e.reset) {
    rl.set(ip, { n: 1, reset: now + RL_WINDOW_MS });
    return false;
  }
  e.n += 1;
  return e.n > RL_MAX;
}

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();
function cacheGet(key: string, now: number): unknown | null {
  const e = cache.get(key);
  if (!e || now - e.at > CACHE_TTL_MS) return null;
  return e.body;
}
function cacheSet(key: string, body: unknown, now: number): void {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: now, body });
}

interface AskBody {
  question?: string;
  city?: string;
  regionLabel?: string;
  boroughs?: string[];
  types?: string[];
}

// Run the aggregate for an "answer" intent and shape a cited response.
async function computeAnswer(cityId: string, metric: AnswerMetric, filters: AskFilters, interpretation: string) {
  const { clauses, params } = buildProjectWhere(filters, 2);
  const where = ["p.city_id = $1", ...clauses].join(" AND ");
  const p = [cityId, ...params];

  let answer = "";
  let detail: Record<string, number | null> | null = null;

  if (metric === "count") {
    const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM projects p WHERE ${where}`, p);
    const n = r.rows[0]?.n ?? 0;
    answer = `${n.toLocaleString()} ${n === 1 ? "project matches" : "projects match"}.`;
    detail = { projects: n };
  } else if (metric === "total_units") {
    const r = await db.query<{ units: number; n: number }>(
      `SELECT COALESCE(SUM(p.units_total),0)::int AS units, COUNT(*)::int AS n FROM projects p WHERE ${where}`,
      p,
    );
    const { units = 0, n = 0 } = r.rows[0] ?? {};
    answer = `${units.toLocaleString()} units across ${n.toLocaleString()} ${n === 1 ? "project" : "projects"}.`;
    detail = { units, projects: n };
  } else if (metric === "units_by_tier") {
    const r = await db.query<Record<string, number>>(
      `SELECT
         COALESCE(SUM(p.units_extremely_low),0)::int AS extremely_low,
         COALESCE(SUM(p.units_very_low),0)::int      AS very_low,
         COALESCE(SUM(p.units_low),0)::int           AS low,
         COALESCE(SUM(p.units_moderate),0)::int      AS moderate,
         COALESCE(SUM(p.units_middle),0)::int        AS middle,
         COUNT(*)::int                               AS n
       FROM projects p WHERE ${where}`,
      p,
    );
    const row = r.rows[0] ?? {};
    detail = {
      extremelyLow: row.extremely_low ?? 0,
      veryLow: row.very_low ?? 0,
      low: row.low ?? 0,
      moderate: row.moderate ?? 0,
      middle: row.middle ?? 0,
      projects: row.n ?? 0,
    };
    answer =
      `Extremely low ${(row.extremely_low ?? 0).toLocaleString()} · ` +
      `very low ${(row.very_low ?? 0).toLocaleString()} · ` +
      `low ${(row.low ?? 0).toLocaleString()} · ` +
      `moderate ${(row.moderate ?? 0).toLocaleString()} · ` +
      `middle ${(row.middle ?? 0).toLocaleString()} units.`;
  } else {
    const r = await db.query<{ earliest: number | null; latest: number | null; n: number }>(
      `SELECT EXTRACT(YEAR FROM MIN(p.start_date))::int AS earliest,
              EXTRACT(YEAR FROM MAX(p.start_date))::int AS latest,
              COUNT(*)::int AS n
       FROM projects p WHERE ${where}`,
      p,
    );
    const { earliest = null, latest = null, n = 0 } = r.rows[0] ?? {};
    answer = earliest && latest ? `Started between ${earliest} and ${latest} (${n.toLocaleString()} projects).` : "No dated projects match.";
    detail = { earliest, latest, projects: n };
  }

  const cites = await db.query<{ name: string; borough: string | null; units_total: number }>(
    `SELECT p.name, p.borough, p.units_total FROM projects p WHERE ${where} ORDER BY p.units_total DESC NULLS LAST LIMIT 5`,
    p,
  );

  return {
    ok: true,
    kind: "answer" as const,
    metric,
    filters,
    interpretation,
    answer,
    detail,
    sources: cites.rows.map((c) => ({ name: c.name, borough: c.borough, units: c.units_total })),
  };
}

// Shape a validated AskResult into the wire response.
async function buildResponse(result: AskResult, city: string, source: "rules" | "model"): Promise<unknown> {
  if (result.kind === "refuse") return { ok: false, refusal: result.refusal, source };
  if (result.kind === "answer" && hasDatabase()) {
    return { ...(await computeAnswer(city, result.metric, result.filters, result.interpretation)), source };
  }
  // filter, or answer with no DB to aggregate against -> just apply the scope
  return { ok: true, kind: "filter", filters: result.filters, interpretation: result.interpretation, source };
}

async function askModel(question: string, system: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0, system, messages: [{ role: "user", content: question }] }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${await resp.text().catch(() => "")}`);
  const data = (await resp.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

export async function POST(req: Request) {
  const now = Date.now();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip, now)) {
    return NextResponse.json({ ok: false, refusal: "Too many questions in a short window — give it a moment." }, { status: 429 });
  }

  let body: AskBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, refusal: "Bad request." }, { status: 400 });
  }

  const question = (body.question ?? "").trim().slice(0, 300);
  const city = (body.city ?? "nyc").toLowerCase();
  const regionLabel = (body.regionLabel ?? "area").slice(0, 40);
  const boroughs = Array.isArray(body.boroughs) ? body.boroughs.filter((b): b is string => typeof b === "string").slice(0, 200) : [];
  const types = Array.isArray(body.types) ? body.types.filter((t): t is string => typeof t === "string").slice(0, 50) : [];
  if (!question) {
    return NextResponse.json({ ok: false, refusal: "Ask a question first." }, { status: 400 });
  }

  const cacheKey = `${city}|${question.toLowerCase()}`;
  const cached = cacheGet(cacheKey, now);
  if (cached) return NextResponse.json(cached);

  const maxYear = new Date().getFullYear() + 5;

  try {
    // Stage 1: deterministic parser (free, offline).
    const heur = heuristicParse(question, { boroughs, types, maxYear });
    let responseBody: unknown;

    if (heur) {
      responseBody = await buildResponse(heur, city, "rules");
    } else if (process.env.ANTHROPIC_API_KEY) {
      // Stage 2: escalate to the model for the long tail.
      const text = await askModel(question, buildSystemPrompt(regionLabel, boroughs, types));
      responseBody = await buildResponse(interpretModelOutput(text, { boroughs, types, maxYear }), city, "model");
    } else {
      responseBody = {
        ok: false,
        refusal:
          "I couldn't parse that. Try something like “new construction in Brooklyn since 2020” or “how many units in Queens”. (Free-form questions need ANTHROPIC_API_KEY configured.)",
      };
    }

    cacheSet(cacheKey, responseBody, now);
    return NextResponse.json(responseBody);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, refusal: "Couldn't interpret that question." }, { status: 200 });
  }
}
