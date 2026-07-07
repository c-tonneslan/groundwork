"use client";

import { useState } from "react";
import { Sparkles, CornerDownLeft, Loader2 } from "lucide-react";
import type { Filters } from "./Sidebar";

type Source = { name: string; borough: string | null; units: number };
type Result =
  | { kind: "info"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "answer"; answer: string; interpretation: string; sources: Source[] };

// Plain-English search + grounded Q&A. Posts the question + the active city's
// real filter vocabulary to /api/ask, which returns a "filter" (narrow the map),
// an "answer" (a cited number over a scope), or a refusal. Both filter and
// answer apply the scope through the same onFiltersChange path the manual
// controls use.
export default function AskBar({
  city,
  cityIds,
  regionLabel,
  boroughs,
  types,
  onResult,
}: {
  city: string;
  cityIds: string[];
  regionLabel: string;
  boroughs: string[];
  types: string[];
  onResult: (r: { city: string; filters: Filters }) => void;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, city, cityIds, regionLabel, boroughs, types }),
      });
      const data = await res.json();
      if (data.ok && data.filters) onResult({ city: data.city ?? city, filters: data.filters as Filters });

      if (data.ok && data.kind === "answer") {
        setResult({
          kind: "answer",
          answer: data.answer ?? "",
          interpretation: data.interpretation ?? "",
          sources: Array.isArray(data.sources) ? data.sources.slice(0, 5) : [],
        });
      } else if (data.ok) {
        setResult({ kind: "info", text: data.interpretation || "Filter applied." });
      } else {
        setResult({ kind: "warn", text: data.refusal || "Couldn't interpret that." });
      }
    } catch {
      setResult({ kind: "warn", text: "Ask failed — try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2.5">
      <form onSubmit={submit} className="relative">
        <Sparkles
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--accent)" }}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask in plain English…"
          aria-label="Ask about the housing data in plain English"
          className="w-full pl-8 pr-8 py-1.5 rounded-md text-xs"
          style={{ background: "var(--surface-2)", border: "1px solid var(--accent)", color: "var(--text)" }}
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          aria-label="Run"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 disabled:opacity-40"
          style={{ color: "var(--accent)" }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
        </button>
      </form>

      {result?.kind === "answer" ? (
        <div
          className="mt-1.5 rounded-md p-2 text-[11px]"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <p style={{ color: "var(--text)" }}>{result.answer}</p>
          {result.interpretation ? (
            <p className="mt-0.5" style={{ color: "var(--text-3)" }}>{result.interpretation}</p>
          ) : null}
          {result.sources.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5" style={{ color: "var(--text-2)" }}>
              {result.sources.map((s, idx) => (
                <li key={idx} className="truncate">
                  · {s.name}
                  {s.units ? <span style={{ color: "var(--text-3)" }}> ({s.units.toLocaleString()})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : result ? (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--text-2)" }}>
          {result.kind === "warn" ? "↪ " : "✓ "}
          {result.text}
        </p>
      ) : (
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-3)" }}>
          e.g. “how many units in Brooklyn since 2020?”
        </p>
      )}
    </div>
  );
}
