// api/cron-update2.mjs — Job-2: Bangladeshi Bangla newspapers sync
// প্রতি ১৫ মিনিটে বাংলাদেশের সব কয়টি বাংলা সংবাদপত্রের RSS থেকে
// খবর scrape করে summarize করে Turso DB-তে যোগ করে।
// Source list: ১৫+ টি জাতীয় দৈনিক
// Schedule: */15 * * * * (GitHub Actions)
// Auth: ?secret=CRON_SECRET  বা  Authorization: Bearer CRON_SECRET

import { createClient } from "@libsql/client";

const MAX_SUMMARY_CHARS = 2000;
const MAX_TOTAL = 30;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SOURCES = [
  { name: "প্রথম আলো",     url: "https://www.prothomalo.com/feed/",                     defaultCat: "জাতীয়" },
  { name: "জাগরণ",          url: "https://www.jugantor.com/rss",                          defaultCat: "জাতীয়" },
  { name: "ইত্তেফাক",       url: "https://www.ittefaq.com.bd/rss",                        defaultCat: "জাতীয়" },
  { name: "কালের কণ্ঠ",     url: "https://www.kalerkantho.com/feed",                      defaultCat: "জাতীয়" },
  { name: "বাংলাদেশ প্রতিদিন", url: "https://www.bd-pratidin.com/rss",                    defaultCat: "জাতীয়" },
  { name: "সমকাল",          url: "https://samakal.com/rss",                               defaultCat: "জাতীয়" },
  { name: "নয়া দিগন্ত",     url: "https://www.dailynayadiganta.com/rss",                  defaultCat: "জাতীয়" },
  { name: "ইনকিলাব",        url: "https://www.dailyinqilab.com/rss",                      defaultCat: "জাতীয়" },
  { name: "ভোরের কাগজ",     url: "https://www.bhorerkagoj.com/rss",                       defaultCat: "জাতীয়" },
  { name: "আমাদের সময়",    url: "https://www.amadershomoy.com/rss",                       defaultCat: "জাতীয়" },
  { name: "মানবজমিন",       url: "https://www.mzamin.com/rss",                            defaultCat: "জাতীয়" },
  { name: "বণিক বার্তা",    url: "https://www.bonikbarta.com/rss",                         defaultCat: "বাণিজ্য" },
  { name: "দৈনিক আজাদী",    url: "https://www.azadi.com.bd/rss",                          defaultCat: "জাতীয়" },
  { name: "দৈনিক সংগ্রাম",  url: "https://www.dailysangram.com/rss",                       defaultCat: "জাতীয়" },
  { name: "দেশ রূপান্তর",   url: "https://www.deshrupantor.com/rss",                      defaultCat: "জাতীয়" },
];

/* ===== Turso / DB ===== */
const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: "file:./data.db" });

await client.execute(`
  CREATE TABLE IF NOT EXISTS news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    subcategory TEXT,
    details     TEXT    NOT NULL,
    image       TEXT,
    video       TEXT,
    time        TEXT    NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).catch(() => {});
try { await client.execute("ALTER TABLE news ADD COLUMN video TEXT"); } catch {}
try { await client.execute("ALTER TABLE news ADD COLUMN subcategory TEXT"); } catch {}

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

/* ===== HTML / XML helpers ===== */
function decodeHtmlEntities(s) {
  if (!s) return "";
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function decodeXmlEntities(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function pickMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"
  );
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function pickArticleBody(html) {
  const re = /"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const m = html.match(re);
  if (!m) return null;
  let raw = m[1];
  raw = raw.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ");
  raw = decodeHtmlEntities(raw);
  raw = raw.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return raw;
}

function pickVideoUrl(html) {
  const mScript = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const s of mScript) {
    if (!/"@type"\s*:\s*"VideoObject"/.test(s)) continue;
    const m1 = s.match(/"embedUrl"\s*:\s*"([^"]+)"/);
    if (m1) return m1[1];
    const m2 = s.match(/"contentUrl"\s*:\s*"([^"]+)"/);
    if (m2) return m2[1];
  }
  const m2 = html.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
  if (m2) return m2[1];
  const m3 = html.match(/<iframe[^>]*\ssrc=["']([^"']*(?:youtube\.com|youtu\.be|player\.vimeo\.com)[^"']*)["']/i);
  if (m3) return m3[1];
  return null;
}

function toEmbedUrl(url) {
  if (!url) return null;
  if (/youtube\.com\/embed\//.test(url) || /player\.vimeo\.com\//.test(url)) return url;
  let m = url.match(/youtube\.com\/watch\?v=([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/youtu\.be\/([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return url;
}

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

function stripHtml(s) {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, "").trim();
}

/* ===== Summarize ===== */
function summarize(text, max = MAX_SUMMARY_CHARS) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(
    cut.lastIndexOf("। "), cut.lastIndexOf("।"),
    cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? ")
  );
  if (lastStop > 100) return clean.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return clean.slice(0, lastSpace > 100 ? lastSpace : max).trim() + "…";
}

/* ===== Detect category from RSS <category> tag or fallback ===== */
const CAT_KEYWORDS = [
  { keywords: ["রাজনীতি", "politics", "রাজনৈতিক"], cat: "রাজনীতি" },
  { keywords: ["খেলা", "ক্রীড়া", "cricket", "football", "ক্রিকেট", "ফুটবল", "sports", "টেনিস"], cat: "খেলা" },
  { keywords: ["অর্থনীতি", "বাণিজ্য", "ব্যবসা", "business", "শেয়ার", "স্টক"], cat: "বাণিজ্য" },
  { keywords: ["বিনোদন", "entertainment", "সিনেমা", "চলচ্চিত্র", "গান", "সংগীত"], cat: "বিনোদন" },
  { keywords: ["আন্তর্জাতিক", "international", "বিশ্ব", "world", "বিদেশ"], cat: "আন্তর্জাতিক" },
  { keywords: ["প্রযুক্তি", "tech", "technology", "মোবাইল", "গ্যাজেট", "software"], cat: "প্রযুক্তি" },
  { keywords: ["শিক্ষা", "education", "বিদ্যালয়", "কলেজ", "বিশ্ববিদ্যালয়"], cat: "শিক্ষা" },
  { keywords: ["স্বাস্থ্য", "health", "চিকিৎসা", "হাসপাতাল"], cat: "স্বাস্থ্য" },
  { keywords: ["মতামত", "opinion", "সম্পাদকীয়", "editorial"], cat: "মতামত" },
  { keywords: ["চাকরি", "job", "jobs", "নিয়োগ", "recruitment"], cat: "চাকরি" },
  { keywords: ["আইন", "law", "বিচার", "আদালত", "crime", "অপরাধ"], cat: "আইন" },
  { keywords: ["জীবনযাপন", "lifestyle", "lifetyle", "খাবার", "ভ্রমণ", "fashion"], cat: "জীবনযাপন" },
];

function detectCategory(title, rssCat, sourceDefault) {
  const haystack = (title + " " + (rssCat || "")).toLowerCase();
  for (const m of CAT_KEYWORDS) {
    for (const kw of m.keywords) {
      if (haystack.includes(kw.toLowerCase())) return m.cat;
    }
  }
  return sourceDefault || "জাতীয়";
}

/* ===== Fetch and parse one feed ===== */
async function fetchFeed(source) {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml" },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = pickAllItems(xml);
    const out = [];
    for (const block of items) {
      const title = pickTag(block, "title");
      const link = pickTag(block, "link");
      if (!title || !link) continue;
      const description = stripHtml(pickTag(block, "description") || "");
      const pubDate = pickTag(block, "pubDate") || "";
      const img = pickAttr(block, "media:content", "url")
               || pickAttr(block, "media:thumbnail", "url")
               || pickAttr(block, "enclosure", "url")
               || null;
      const rssCat = pickTag(block, "category") || null;
      const cat = detectCategory(title, rssCat, source.defaultCat);
      out.push({ title, link, description, pubDate, image: img, category: cat, source: source.name });
    }
    return out;
  } catch {
    return [];
  }
}

/* ===== Fetch + parse one article page ===== */
async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ogTitle = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");
    const image = pickMeta(html, "og:image") || pickMeta(html, "twitter:image");
    const body = pickArticleBody(html);
    const video = toEmbedUrl(pickVideoUrl(html));
    const ogDesc = pickMeta(html, "og:description");
    return {
      title: ogTitle,
      image,
      summary: summarize(body) || ogDesc,
      video,
      link: url
    };
  } catch { return null; }
}

/* ===== Insert / self-heal ===== */
async function insertOrUpdate(it, sourceName) {
  const cat = it.category || "জাতীয়";
  const summary = it.summary || it.description || "";
  const details = summary
    ? `${summary}\n\n— সারসংক্ষেপ (${sourceName}): ${it.link}`
    : `সূত্র (${sourceName}): ${it.link}`;

  const existing = await get(
    "SELECT id, details, video FROM news WHERE title = ? LIMIT 1",
    it.title
  );
  if (existing) {
    const needsDetails = (existing.details || "").length < 200 && summary;
    const needsVideo = !existing.video && it.video;
    if (needsDetails || needsVideo) {
      const newDetails = needsDetails
        ? `${summary}\n\n— সারসংক্ষেপ (${sourceName}): ${it.link}`.slice(0, 2000)
        : existing.details;
      const newVideo = needsVideo ? it.video : existing.video;
      await run("UPDATE news SET details = ?, video = ? WHERE id = ?", newDetails, newVideo, existing.id);
      return { id: existing.id, title: it.title, cat, action: "updated" };
    }
    return { id: existing.id, title: it.title, cat, action: "skipped" };
  }
  const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const r = await run(
    "INSERT INTO news (title, category, subcategory, details, image, video, time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    it.title, cat, null, details.slice(0, 2000), it.image || null, it.video || null, time
  );
  return { id: r.lastInsertRowid, title: it.title, cat, action: "added" };
}

/* ===== Main handler ===== */
export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const provided =
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") ||
    (req.query && req.query.secret) || "";
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    /* 1. Fetch all feeds in parallel */
    const feedResults = await Promise.all(SOURCES.map(s => fetchFeed(s)));
    const allItems = [];
    const perSource = {};
    SOURCES.forEach((s, i) => {
      perSource[s.name] = feedResults[i].length;
      for (const item of feedResults[i]) {
        allItems.push({ ...item, sourceName: s.name });
      }
    });

    if (allItems.length === 0) {
      return res.status(200).json({ ok: true, job: "Job-2", added: 0, message: "No items found in any feed" });
    }

    /* 2. Shuffle for diversity, then take top MAX_TOTAL */
    for (let i = allItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allItems[i], allItems[j]] = [allItems[j], allItems[i]];
    }
    const selected = allItems.slice(0, MAX_TOTAL);

    /* 3. Fetch full article pages (4 at a time) */
    const articles = [];
    for (let i = 0; i < selected.length; i += 4) {
      const batch = await Promise.all(selected.slice(i, i + 4).map(it => fetchArticle(it.link)));
      for (let j = 0; j < batch.length; j++) {
        const a = batch[j];
        const orig = selected[i + j];
        if (a && a.title) {
          articles.push({ ...orig, title: a.title, image: a.image || orig.image, summary: a.summary || orig.description, video: a.video });
        } else if (orig.title) {
          articles.push(orig);
        }
      }
    }

    /* 4. Insert / update */
    const results = [];
    const byCategory = {};
    for (const it of articles) {
      const r = await insertOrUpdate(it, it.sourceName);
      results.push(r);
      if (r.action === "added") {
        byCategory[r.cat] = (byCategory[r.cat] || 0) + 1;
      }
    }

    return res.status(200).json({
      ok: true,
      job: "Job-2",
      source: "বাংলাদেশের ১৫টি বাংলা সংবাদপত্র",
      sources: perSource,
      totalFound: allItems.length,
      selected: selected.length,
      articles: articles.length,
      added: results.filter(r => r.action === "added").length,
      updated: results.filter(r => r.action === "updated").length,
      skipped: results.filter(r => r.action === "skipped").length,
      byCategory,
      results: results.slice(0, 50)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, job: "Job-2", error: err.message });
  }
}
