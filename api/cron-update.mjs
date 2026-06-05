// api/cron-update.mjs — Vercel / GitHub Actions Cron Job
// প্রতি ৬ ঘণ্টায় Prothom Alo এর sports section থেকে
// ৫টি নতুন খবর Turso DB-তে যোগ করে।
// Schedule: 0 star-slash-6 (UTC) = প্রতি ছয় ঘণ্টায়
// Auth: ?secret=CRON_SECRET  বা  Authorization: Bearer CRON_SECRET

import { createClient } from "@libsql/client";

const FEED_URL  = "https://www.prothomalo.com/feed/";
const CATEGORY  = "খেলা";
const LIMIT     = 5;
const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ===== Turso / DB ===== */
const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: "file:./data.db" });

async function all(sql, ...args) {
  const r = await client.execute({ sql, args });
  return r.rows || [];
}
async function get(sql, ...args) {
  const r = await client.execute({ sql, args });
  return r.rows && r.rows[0] ? r.rows[0] : null;
}
async function run(sql, ...args) {
  const r = await client.execute({ sql, args });
  return {
    lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined,
    changes: r.rowsAffected
  };
}

/* ===== XML helpers (no external parser) ===== */
function decodeXmlEntities(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseIntInt(n, 16)))
    .replace(/&amp;/g, "&");
}
function parseIntInt(s, base) { return parseInt(s, base); }

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXmlEntities(m[1].trim()) : null;
}
function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}
function pickAllItems(xml) {
  const out = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/* ===== HTML helpers ===== */
function pickMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

/* Extract the full article body from the JSON-LD <script> block.
   Prothom Alo embeds the full text as `articleBody` in escaped HTML. */
function pickArticleBody(html) {
  const re = /"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const m = html.match(re);
  if (!m) return null;
  let raw = m[1];
  /* JSON string → real text (only the escapes we expect) */
  raw = raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ");
  /* unescape HTML entities */
  raw = raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  /* strip tags, keep paragraph breaks */
  raw = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return raw;
}

/* ===== Core ===== */
async function fetchFeed() {
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml" }
  });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  return await res.text();
}

function extractSportsItems(xml) {
  const items = pickAllItems(xml);
  const out = [];
  for (const block of items) {
    const link = pickTag(block, "link");
    if (!link || !/\/sports\//.test(link)) continue;
    out.push({
      title:    pickTag(block, "title")    || "",
      link,
      pubDate:  pickTag(block, "pubDate")  || "",
      image:    pickAttr(block, "media:content", "url")
             || pickAttr(block, "media:thumbnail", "url")
             || null
    });
    if (out.length >= LIMIT) break;
  }
  return out;
}

async function fetchArticleSummary(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow"
    });
    if (!res.ok) return { description: null, body: null, image: null };
    const html = await res.text();
    return {
      description: pickMeta(html, "og:description") || pickMeta(html, "twitter:description") || pickMeta(html, "description"),
      body:        pickArticleBody(html),
      image:       pickMeta(html, "og:image")       || pickMeta(html, "twitter:image")
    };
  } catch {
    return { description: null, body: null, image: null };
  }
}

function titleExists(title) {
  return get("SELECT 1 AS x FROM news WHERE title = ? LIMIT 1", title).then(Boolean);
}

async function insertNews({ title, image, details }) {
  const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const r = await run(
    "INSERT INTO news (title, category, details, image, time) VALUES (?, ?, ?, ?, ?)",
    title, CATEGORY, details, image, time
  );
  return r.lastInsertRowid;
}

/* ===== Vercel Cron handler ===== */
export default async function handler(req, res) {
  /* Auth: Vercel Cron স্বয়ংক্রিয়ভাবে Authorization header পাঠায় না,
     তাই আমরা ?secret=... query param বা CRON_SECRET env চেক করি। */
  const expected = process.env.CRON_SECRET;
  const provided =
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") ||
    (req.query && req.query.secret) ||
    "";
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const xml = await fetchFeed();
    const items = extractSportsItems(xml);
    if (items.length === 0) {
      return res.status(200).json({ ok: true, added: 0, message: "No sports items in feed" });
    }

    /* Article summaries একসাথে আনি (parallel) */
    const enriched = await Promise.all(
      items.map(async (it) => {
        const extra = await fetchArticleSummary(it.link);
        return { ...it, description: extra.description, body: extra.body, image: extra.image || it.image };
      })
    );

    const added = [];
    const skipped = [];
    for (const it of enriched) {
      /* পূর্ণ article body পাওয়া গেলে সেটাই details হিসেবে রাখি,
         না পারলে og:description, না পারলে fallback বাক্য। */
      const details = (it.body && it.body.length > 40)
        ? `${it.body}\n\n— সূত্র: Prothom Alo (${it.link})`
        : it.description
          ? `${it.description}\n\n— সূত্র: Prothom Alo (${it.link})`
          : `Prothom Alo থেকে সংগৃহীত।\nসূত্র: ${it.link}`;

      const existing = await get("SELECT id, details FROM news WHERE title = ? LIMIT 1", it.title);
      if (existing) {
        /* যদি আগের details খুব ছোট হয় (শুধু og:description ছিল),
           তাহলে full body দিয়ে update করি — self-healing। */
        if ((existing.details || "").length < 300 && it.body && it.body.length > 40) {
          const newDetails = `${it.body}\n\n— সূত্র: Prothom Alo (${it.link})`.slice(0, 8000);
          await run("UPDATE news SET details = ? WHERE id = ?", newDetails, existing.id);
          added.push({ id: existing.id, title: it.title, action: "updated" });
        } else {
          skipped.push({ id: existing.id, title: it.title, reason: "duplicate" });
        }
        continue;
      }
      try {
        const id = await insertNews({
          title:   it.title,
          image:   it.image,
          details: details.slice(0, 8000) /* row safeguard */
        });
        added.push({ id, title: it.title, bodyLen: it.body ? it.body.length : 0 });
      } catch (err) {
        skipped.push({ title: it.title, reason: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      source: "Prothom Alo (sports)",
      category: CATEGORY,
      fetched: items.length,
      added: added.length,
      skipped: skipped.length,
      addedItems: added,
      skippedItems: skipped
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
