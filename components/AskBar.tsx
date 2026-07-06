"use client";

import { useState } from "react";
import { Sparkles, CornerDownLeft, Loader2 } from "lucide-react";
import type { Filters } from "./Sidebar";

// Plain-English search. Posts the question + the current city's real filter
// vocabulary to /api/ask, which returns a constrained { query, borough, type,
// minUnits, startYear } filter (or a refusal). On success we apply it through
// the same onFiltersChange path the manual controls use.
export default function AskBar({
  city,
  regionLabel,
  boroughs,
  types,
  onApply,
}: {
  city: string;
  regionLabel: string;
  boroughs: string[];
  types: string[];
  onApply: (f: Filters) => void;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "warn"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, city, regionLabel, boroughs, types }),
      });
      const data = await res.json();
      if (data.ok && data.filters) {
        onApply(data.filters as Filters);
        setMsg({ kind: "info", text: data.interpretation || "Filter applied." });
      } else {
        setMsg({ kind: "warn", text: data.refusal || "Couldn't interpret that." });
      }
    } catch {
      setMsg({ kind: "warn", text: "Ask failed — try again." });
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
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--accent)",
            color: "var(--text)",
          }}
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
      {msg ? (
        <p
          className="mt-1.5 text-[11px] leading-snug"
          style={{ color: msg.kind === "warn" ? "var(--text-2)" : "var(--text-2)" }}
        >
          {msg.kind === "warn" ? "↪ " : "✓ "}
          {msg.text}
        </p>
      ) : (
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-3)" }}>
          e.g. “large new construction since 2020”
        </p>
      )}
    </div>
  );
}
