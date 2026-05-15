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
    const [nyc, sf] = await Promise.all([loadNYC(), loadSF()]);
    console.log(`upserting ${nyc.length} NYC + ${sf.length} SF reps...`);
    for (const m of [...nyc, ...sf]) {
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
