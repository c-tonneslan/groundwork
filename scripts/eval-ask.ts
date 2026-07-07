// Live eval for /api/ask: run a held-out question set through the real model +
// the production translation core, and score intent classification, filter
// extraction, and refusal correctness. Needs ANTHROPIC_API_KEY.
//   npm run eval:ask
import { buildSystemPrompt, interpretModelOutput, type AskResult } from "../lib/ask.ts";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the eval.");
  process.exit(1);
}
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

const BOROUGHS = ["Brooklyn", "Manhattan", "Queens", "Bronx", "Staten Island"];
const TYPES = ["New Construction", "Preservation"];
const OPTS = { boroughs: BOROUGHS, types: TYPES, maxYear: new Date().getFullYear() + 5 };

// Each case asserts the important slots — not the exact interpretation prose.
interface Case {
  q: string;
  kind: AskResult["kind"];
  borough?: string;
  type?: string;
  metric?: string;
  minUnitsAtLeast?: number;
  startYear?: number;
}

const CASES: Case[] = [
  { q: "new construction in Brooklyn", kind: "filter", borough: "Brooklyn", type: "New Construction" },
  { q: "preservation projects in manhattan", kind: "filter", borough: "Manhattan", type: "Preservation" },
  { q: "large developments since 2020", kind: "filter", minUnitsAtLeast: 50, startYear: 2020 },
  { q: "anything in the bronx", kind: "filter", borough: "Bronx" },
  { q: "projects with at least 200 units", kind: "filter", minUnitsAtLeast: 200 },
  { q: "how many projects are there in Queens", kind: "answer", metric: "count", borough: "Queens" },
  { q: "how many affordable units total in Brooklyn", kind: "answer", metric: "total_units", borough: "Brooklyn" },
  { q: "break units down by income tier", kind: "answer", metric: "units_by_tier" },
  { q: "what years do the projects span", kind: "answer", metric: "date_range" },
  { q: "which projects are closest to the subway", kind: "refuse" },
  { q: "show me the cheapest apartments", kind: "refuse" },
  { q: "three bedroom family units", kind: "refuse" },
  { q: "highest rent burden neighborhoods", kind: "refuse" },
];

async function ask(question: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: 0,
      system: buildSystemPrompt("borough", BOROUGHS, TYPES),
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

function score(r: AskResult, c: Case): { ok: boolean; why: string } {
  if (r.kind !== c.kind) return { ok: false, why: `intent ${r.kind} != ${c.kind}` };
  if (r.kind === "refuse") return { ok: true, why: "refused" };
  if (c.borough && r.filters.borough !== c.borough) return { ok: false, why: `borough ${r.filters.borough || "∅"} != ${c.borough}` };
  if (c.type && r.filters.type !== c.type) return { ok: false, why: `type ${r.filters.type || "∅"} != ${c.type}` };
  if (c.minUnitsAtLeast != null && r.filters.minUnits < c.minUnitsAtLeast) return { ok: false, why: `minUnits ${r.filters.minUnits} < ${c.minUnitsAtLeast}` };
  if (c.startYear != null && r.filters.startYear !== c.startYear) return { ok: false, why: `startYear ${r.filters.startYear} != ${c.startYear}` };
  if (r.kind === "answer" && c.metric && r.metric !== c.metric) return { ok: false, why: `metric ${r.metric} != ${c.metric}` };
  return { ok: true, why: "ok" };
}

let pass = 0;
let refusalCorrect = 0;
let refusalTotal = 0;
for (const c of CASES) {
  if (c.kind === "refuse") refusalTotal += 1;
  let r: AskResult;
  try {
    r = interpretModelOutput(await ask(c.q), OPTS);
  } catch (e) {
    console.log(`ERR   ${c.q}  (${(e as Error).message})`);
    continue;
  }
  const s = score(r, c);
  if (s.ok) pass += 1;
  if (c.kind === "refuse" && r.kind === "refuse") refusalCorrect += 1;
  console.log(`${s.ok ? "PASS" : "FAIL"}  ${c.q.padEnd(42)} -> ${r.kind}${s.ok ? "" : "  (" + s.why + ")"}`);
}

console.log(`\nOverall: ${pass}/${CASES.length} (${Math.round((pass / CASES.length) * 100)}%)`);
console.log(`Refusal recall: ${refusalCorrect}/${refusalTotal}`);
process.exit(pass === CASES.length ? 0 : 1);
