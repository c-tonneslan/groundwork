// POST /api/ask
//
// Natural-language search. Translates a plain-English question ("family-sized
// new construction in Brooklyn since 2020") into the SAME constrained filter
// object the sidebar produces { query, borough, type, minUnits, startYear }.
//
// Design note: the model NEVER writes SQL. It only picks values for a fixed
// filter schema, and the API whitelists every value against the vocabulary the
// client sent (real borough/type values for that city). So there's no injection
// surface — the returned filter runs through the existing parameterized query.
// If the question needs a field the data can't express (transit proximity, rent
// burden, bedroom mix, price), the model REFUSES rather than inventing a filter.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const NEXT_YEAR = new Date().getFullYear() + 5;

interface AskBody {
  question?: string;
  city?: string;
  regionLabel?: string;
  boroughs?: string[];
  types?: string[];
}

function systemPrompt(regionLabel: string, boroughs: string[], types: string[]): string {
  return `You translate a plain-English question about affordable-housing projects into a JSON filter. You can ONLY filter on these five fields:
- query: free text matched against project name / address / neighborhood. String, or "" for none.
- borough: the local "${regionLabel}" field. MUST be exactly one of: ${JSON.stringify(boroughs)} — or "" for any.
- type: construction type. MUST be exactly one of: ${JSON.stringify(types)} — or "" for any.
- minUnits: minimum total units. Integer >= 0 (0 means no minimum).
- startYear: include only projects that started in or after this 4-digit year. Integer, or null.

Rules:
- Map the question onto these fields only. Match borough/type case-insensitively to the CLOSEST allowed value; never output a value that is not in the allowed list.
- "large"/"big" -> a reasonable minUnits (e.g. 100). "family-sized" is about bedroom counts, which you CANNOT filter — treat it as unsupported.
- If the question needs anything these five fields cannot express (proximity to transit/subway, rent burden, expiring affordability, income tier, bedroom mix, cheapest/price, distance), DO NOT invent a filter. Set "refuse": true and briefly say what you can't do, plus the closest supported alternative.
- Respond with ONLY a JSON object, no prose or markdown, in exactly this shape:
{"refuse": false, "filters": {"query": "", "borough": "", "type": "", "minUnits": 0, "startYear": null}, "interpretation": "short human summary of the filter"}
or, to refuse:
{"refuse": true, "refusal": "one short sentence"}`;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no json in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, refusal: "Natural-language search isn't configured on this deployment." },
      { status: 200 },
    );
  }

  let body: AskBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, refusal: "Bad request." }, { status: 400 });
  }

  const question = (body.question ?? "").trim().slice(0, 300);
  const regionLabel = (body.regionLabel ?? "area").slice(0, 40);
  const boroughs = Array.isArray(body.boroughs) ? body.boroughs.filter((b) => typeof b === "string").slice(0, 200) : [];
  const types = Array.isArray(body.types) ? body.types.filter((t) => typeof t === "string").slice(0, 50) : [];
  if (!question) {
    return NextResponse.json({ ok: false, refusal: "Ask a question first." }, { status: 400 });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0,
        system: systemPrompt(regionLabel, boroughs, types),
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!resp.ok) {
      console.error("anthropic error", resp.status, await resp.text().catch(() => ""));
      return NextResponse.json({ ok: false, refusal: "The language model is unavailable right now." }, { status: 200 });
    }

    const data = (await resp.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const parsed = extractJson(text) as {
      refuse?: boolean;
      refusal?: string;
      interpretation?: string;
      filters?: { query?: unknown; borough?: unknown; type?: unknown; minUnits?: unknown; startYear?: unknown };
    };

    if (parsed.refuse || !parsed.filters) {
      return NextResponse.json({
        ok: false,
        refusal: (parsed.refusal ?? "That can't be answered with the available filters.").slice(0, 240),
      });
    }

    // Whitelist every value against what the client actually has. Anything the
    // model returned that isn't a real option is dropped, not trusted.
    const f = parsed.filters;
    const borough = typeof f.borough === "string" && boroughs.includes(f.borough) ? f.borough : "";
    const type = typeof f.type === "string" && types.includes(f.type) ? f.type : "";
    const minUnitsRaw = Number(f.minUnits);
    const minUnits = Number.isFinite(minUnitsRaw) ? Math.max(0, Math.min(100000, Math.round(minUnitsRaw))) : 0;
    const yearRaw = Number(f.startYear);
    const startYear =
      f.startYear != null && Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= NEXT_YEAR
        ? Math.round(yearRaw)
        : null;
    const query = typeof f.query === "string" ? f.query.trim().slice(0, 200) : "";

    return NextResponse.json({
      ok: true,
      filters: { query, borough, type, minUnits, startYear },
      interpretation: (parsed.interpretation ?? "Filter applied.").slice(0, 240),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, refusal: "Couldn't interpret that question." }, { status: 200 });
  }
}
