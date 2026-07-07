// Deterministic tests for the /api/ask translation core. No API key, no DB, no
// clock — we feed canned model output to interpretModelOutput and assert the
// validated result. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretModelOutput, validateFilters } from "../lib/ask.ts";

const V = {
  boroughs: ["Brooklyn", "Manhattan", "Queens"],
  types: ["New Construction", "Preservation"],
  maxYear: 2030,
};

test("filter intent maps borough, type, minUnits, year", () => {
  const out = interpretModelOutput(
    JSON.stringify({
      intent: "filter",
      filters: { query: "", borough: "Brooklyn", type: "New Construction", minUnits: 100, startYear: 2020 },
      interpretation: "x",
    }),
    V,
  );
  assert.equal(out.kind, "filter");
  if (out.kind === "filter") {
    assert.equal(out.filters.borough, "Brooklyn");
    assert.equal(out.filters.type, "New Construction");
    assert.equal(out.filters.minUnits, 100);
    assert.equal(out.filters.startYear, 2020);
  }
});

test("invented borough/type values are dropped (whitelist)", () => {
  const out = interpretModelOutput(
    JSON.stringify({ intent: "filter", filters: { borough: "Atlantis", type: "Skyscraper" } }),
    V,
  );
  assert.equal(out.kind, "filter");
  if (out.kind === "filter") {
    assert.equal(out.filters.borough, "");
    assert.equal(out.filters.type, "");
  }
});

test("negative units clamp to 0, absurd year drops to null", () => {
  const f = validateFilters({ minUnits: -5, startYear: 3000 }, V.boroughs, V.types, V.maxYear);
  assert.equal(f.minUnits, 0);
  assert.equal(f.startYear, null);
});

test("refuse intent passes the message through", () => {
  const out = interpretModelOutput(JSON.stringify({ intent: "refuse", refusal: "no transit data available" }), V);
  assert.equal(out.kind, "refuse");
  if (out.kind === "refuse") assert.match(out.refusal, /transit/);
});

test("answer intent keeps a valid metric and scope", () => {
  const out = interpretModelOutput(
    JSON.stringify({ intent: "answer", metric: "total_units", filters: { borough: "Queens" }, interpretation: "units in queens" }),
    V,
  );
  assert.equal(out.kind, "answer");
  if (out.kind === "answer") {
    assert.equal(out.metric, "total_units");
    assert.equal(out.filters.borough, "Queens");
  }
});

test("answer intent with unknown metric falls back to count", () => {
  const out = interpretModelOutput(JSON.stringify({ intent: "answer", metric: "bogus", filters: {} }), V);
  assert.equal(out.kind, "answer");
  if (out.kind === "answer") assert.equal(out.metric, "count");
});

test("garbage output refuses instead of throwing", () => {
  const out = interpretModelOutput("the model replied with prose and no json", V);
  assert.equal(out.kind, "refuse");
});

test("json embedded in prose/markdown is extracted", () => {
  const out = interpretModelOutput(
    'Sure!\n```json\n{"intent":"filter","filters":{"borough":"Manhattan"}}\n```\nDone.',
    V,
  );
  assert.equal(out.kind, "filter");
  if (out.kind === "filter") assert.equal(out.filters.borough, "Manhattan");
});
