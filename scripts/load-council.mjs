// Pull current city council / board-of-supervisors rosters into the
// council_members table.
//
//   node scripts/load-council.mjs
//
// NYC: scrapes council.nyc.gov/district-N for districts 1..51. The
// page title carries "District N - Council Member Name" and the
// contact-info block has email/phone where listed.
//
// SF: sfbos.org dropped per-district pages, so we scrape the single
// /about-board-of-supervisors/ page and pull names from alt-text on
// the supervisor portrait slides (pattern: "District NN - Supervisor Name").
//
// Names go stale every 2-4 years with elections; rerunning the script
// is the refresh story. Each city's loader is independent.

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  console.error("error: DATABASE_URL is not set.");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase")
    ? { rejectUnauthorized: false }
    : false,
});

const UA = "Mozilla/5.0 (groundwork; +https://github.com/c-tonneslan/groundwork)";

// --- helpers ---

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .trim();
}

function firstMatch(html, regex) {
  const m = html.match(regex);
  return m ? decodeEntities(m[1].trim()) : null;
}

async function fetchHtml(url) {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) return null;
  return resp.text();
}

// --- NYC scraper ---

async function fetchNycMember(district) {
  const url = `https://council.nyc.gov/district-${district}/`;
  const html = await fetchHtml(url);
  if (!html) return null;

  // Most pages: <title>District N - Council Member Name</title>
  // Some pages: <title>Home - Council Member Name</title>
  const title = firstMatch(html, /<title>([^<]+)<\/title>/i) ?? "";
  let name = title
    .replace(/^(District\s+\d+|Home)\s*[-–—]\s*/i, "")
    .replace(/\s*\|\s*.*$/, "")
    .trim();
  if (!name) return null;

  const email = firstMatch(html, /href="mailto:([^"]+)"/);
  const phone = firstMatch(html, /tel:([^"]+)/);

  // Photo: most district pages embed a hero portrait under .wp-post-image
  // or a similarly-named class. We grab the first <img> with the member's
  // first name in the alt text, which is a decent heuristic.
  let photoUrl = null;
  const firstName = name.split(/\s+/)[0];
  const photoRegex = new RegExp(
    `<img[^>]+src="([^"]+)"[^>]*alt="[^"]*${firstName}[^"]*"`,
    "i",
  );
  photoUrl = firstMatch(html, photoRegex);

  return {
    city_id: "nyc",
    district: String(district),
    name,
    party: null,
    website_url: url,
    email,
    phone,
    photo_url: photoUrl,
  };
}

async function loadNYC() {
  const out = [];
  for (let d = 1; d <= 51; d++) {
    process.stdout.write(`\r[nyc] district ${d}/51...`);
    try {
      const m = await fetchNycMember(d);
      if (m) out.push(m);
    } catch {
      // ignore, keep going
    }
  }
  process.stdout.write("\n");
  return out;
}

// --- SF scraper ---

async function loadSF() {
  // sfbos.org homepage renders a card grid of all 11 supervisors. Each card
  // has href="/profile--name/" (or "/alan-wong/" for D4), aria-label with
  // the full name, and a photo URL whose path encodes the district as
  // "D01-..", "D02-..", etc.
  const homeUrl = "https://sfbos.org/";
  const html = await fetchHtml(homeUrl);
  if (!html) {
    process.stdout.write("[sfo] couldn't fetch sfbos.org\n");
    return [];
  }

  const cardRe =
    /href="(\/[a-z0-9-]+(?:--[a-z0-9-]+)?\/)"\s+aria-label="profile page of ([^"]+)"[^>]*>[\s\S]{0,800}?src="(https:\/\/media\.api\.sf\.gov\/images\/D(\d{1,2})-[^"]+)"/g;

  const seen = new Map();
  let m;
  while ((m = cardRe.exec(html)) != null) {
    const path = m[1];
    const name = decodeEntities(m[2].trim());
    const photoUrl = m[3];
    const district = String(parseInt(m[4], 10));
    if (!seen.has(district)) {
      seen.set(district, {
        name,
        photo_url: photoUrl,
        website_url: `https://sfbos.org${path}`,
      });
    }
  }

  const out = [];
  for (const [district, info] of seen) {
    out.push({
      city_id: "sfo",
      district,
      name: info.name,
      party: null,
      website_url: info.website_url,
      email: null,
      phone: null,
      photo_url: info.photo_url,
    });
  }
  process.stdout.write(`[sfo] scraped ${out.length}/11 supervisors\n`);
  return out;
}

// --- LA + DC scrapers (Wikipedia API) ---
//
// LA City Hall and DC's per-ward sites have inconsistent or empty title
// metadata, but Wikipedia keeps a structured "Members" table for both
// that's machine-readable via the parse API. Names go stale on the same
// 2-4 year cycle as the per-district sites, just less frequently for
// chair seats.

async function fetchWikipediaSectionHtml(page, sectionIndex) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("section", String(sectionIndex));
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "text");
  url.searchParams.set("origin", "*");
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json?.parse?.text?.["*"] ?? null;
}

function extractWikiRoster(html, districtRegex) {
  // Each table row has cells. Cell 0 is the seat label (e.g. "Ward 5",
  // "5", "At-large"). The member name is in a span.fn or a title= attr.
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const out = new Map();
  for (const r of rows) {
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 2) continue;
    const seat = tds[0].replace(/<[^>]+>/g, "").trim();
    const districtMatch = seat.match(districtRegex);
    if (!districtMatch) continue;
    const district = districtMatch[1];
    const nameMatch =
      r.match(/class="fn"[^>]*>(?:<a[^>]*>)?([^<]+)</) ||
      r.match(/<a[^>]*title="([^"]+)"/);
    if (!nameMatch) continue;
    const name = decodeEntities(nameMatch[1].trim());
    if (!out.has(district)) out.set(district, name);
  }
  return out;
}

async function loadLA() {
  // Find the section that holds the "Members" table.
  const sectionsUrl = new URL("https://en.wikipedia.org/w/api.php");
  sectionsUrl.searchParams.set("action", "parse");
  sectionsUrl.searchParams.set("page", "Los Angeles City Council");
  sectionsUrl.searchParams.set("format", "json");
  sectionsUrl.searchParams.set("prop", "sections");
  let memberSection = 3; // observed default at time of writing
  try {
    const resp = await fetch(sectionsUrl, { headers: { "User-Agent": UA } });
    const json = await resp.json();
    const found = json?.parse?.sections?.find?.((s) =>
      /members/i.test(s.line ?? ""),
    );
    if (found?.index) memberSection = parseInt(found.index, 10);
  } catch {
    // fall through to default
  }

  const html = await fetchWikipediaSectionHtml(
    "Los Angeles City Council",
    memberSection,
  );
  if (!html) {
    process.stdout.write("[lax] couldn't fetch wikipedia page\n");
    return [];
  }
  const roster = extractWikiRoster(html, /^(\d+)$/);

  const out = [];
  for (const [district, name] of roster) {
    const d = parseInt(district, 10);
    if (d < 1 || d > 15) continue;
    out.push({
      city_id: "lax",
      district: String(d),
      name,
      party: null,
      website_url: `https://cd${d}.lacity.gov/`,
      email: null,
      phone: null,
      photo_url: null,
    });
  }
  process.stdout.write(`[lax] scraped ${out.length}/15 councilmembers\n`);
  return out;
}

async function loadDC() {
  const html = await fetchWikipediaSectionHtml(
    "Council of the District of Columbia",
    4,
  );
  if (!html) {
    process.stdout.write("[dc] couldn't fetch wikipedia page\n");
    return [];
  }
  const roster = extractWikiRoster(html, /^Ward\s+(\d+)$/i);

  const out = [];
  for (const [district, name] of roster) {
    out.push({
      city_id: "dc",
      district,
      name,
      party: null,
      website_url: `https://dccouncil.gov/council/ward-${district}/`,
      email: null,
      phone: null,
      photo_url: null,
    });
  }
  process.stdout.write(`[dc] scraped ${out.length}/8 ward councilmembers\n`);
  return out;
}

// --- upsert ---

const UPSERT_SQL = `
INSERT INTO council_members (
  city_id, district, name, party, website_url, email, phone, photo_url, imported_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
ON CONFLICT (city_id, district) DO UPDATE SET
  name        = EXCLUDED.name,
  party       = EXCLUDED.party,
  website_url = EXCLUDED.website_url,
  email       = EXCLUDED.email,
  phone       = EXCLUDED.phone,
  photo_url   = EXCLUDED.photo_url,
  imported_at = NOW();
`;

async function main() {
  const client = await pool.connect();
  try {
    const [nyc, sf, la, dc] = await Promise.all([
      loadNYC(),
      loadSF(),
      loadLA(),
      loadDC(),
    ]);
    console.log(
      `upserting ${nyc.length} NYC + ${sf.length} SF + ${la.length} LA + ${dc.length} DC reps...`,
    );
    for (const m of [...nyc, ...sf, ...la, ...dc]) {
      await client.query(UPSERT_SQL, [
        m.city_id, m.district, m.name, m.party,
        m.website_url, m.email, m.phone, m.photo_url,
      ]);
    }
    console.log("done.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
