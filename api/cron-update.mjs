// api/cron-update.mjs — Vercel / External Cron Job
// প্রতি ১০ মিনিটে Prothom Alo এর মূল RSS feed থেকে সব খবর scrape করে
// summarize করে Turso DB-তে যোগ করে (per-category limit নেই)।
// Schedule: */10 * * * * (GitHub Actions) বা cron-job.org
// Auth: ?secret=CRON_SECRET  বা  Authorization: Bearer CRON_SECRET

import { createClient } from "@libsql/client";

const FEED_URL    = "https://www.prothomalo.com/feed/";
const MAX_SUMMARY_CHARS = 2000;
// no per-category limit — all items from feed are processed
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ===== Turso / DB ===== */
const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: "file:./data.db" });

/* Schema init */
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
try { await client.execute("ALTER TABLE news ADD COLUMN gallery TEXT"); } catch {}

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

/* ===== HTML helpers ===== */
function decodeHtmlEntities(s) {
  if (!s) return "";
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function pickMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function pickGalleryImages(html, exclude) {
  const urls = [];
  const seen = new Set();
  if (exclude) seen.add(exclude.split("?")[0]);
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    const key = src.split("?")[0];
    if (src && src.startsWith("http") && !seen.has(key)) {
      seen.add(key);
      urls.push(src);
      if (urls.length >= 10) break;
    }
  }
  return urls;
}

function pickArticleBody(html) {
  const re = /"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const m = html.match(re);
  if (!m) return null;
  let raw = m[1];
  raw = raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ");
  raw = decodeHtmlEntities(raw);
  raw = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const re2 = /<video[^>]*\ssrc=["']([^"']+)["']/i;
  const m2 = html.match(re2);
  if (m2) return m2[1];
  const re3 = /<iframe[^>]*\ssrc=["']([^"']*(?:youtube\.com|youtu\.be|player\.vimeo\.com)[^"']*)["']/i;
  const m3 = html.match(re3);
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

/* ===== Prothom Alo URL → Bengali category + subcategory ===== */
const SLUG_TO_CAT = [
  { slug: "sports",        cat: "খেলা" },
  { slug: "bangladesh",    cat: "জাতীয়" },
  { slug: "international", cat: "আন্তর্জাতিক" },
  { slug: "politics",      cat: "রাজনীতি" },
  { slug: "world",         cat: "বিশ্ব" },
  { slug: "business",      cat: "বাণিজ্য" },
  { slug: "opinion",       cat: "মতামত" },
  { slug: "entertainment", cat: "বিনোদন" },
  { slug: "tech",          cat: "প্রযুক্তি" },
  { slug: "jobs",          cat: "চাকরি" },
  { slug: "lifestyle",     cat: "জীবনযাপন" },
  { slug: "video",         cat: "ভিডিও" },
  { slug: "chakri",        cat: "চাকরি" }
];

const SLUG_TO_SUBCAT = {
  /* খেলা */
  cricket:    "ক্রিকেট",
  football:   "ফুটবল",
  tennis:     "টেনিস",
  hockey:     "হকি",
  badminton:  "ব্যাডমিন্টন",
  kabaddi:    "কাবাডি",
  golf:       "গলফ",
  chess:      "দাবা",
  archery:    "তীরন্দাজি",
  athletics:  "অ্যাথলেটিক্স",
  swimming:   "সাঁতার",
  boxing:     "বক্সিং",
  esports:    "ই-স্পোর্টস",
  /* জাতীয় */
  politics:   "রাজনীতি",
  government: "সরকার",
  law:        "আইন",
  education:  "শিক্ষা",
  health:     "স্বাস্থ্য",
  crime:      "অপরাধ",
  /* আন্তর্জাতিক */
  asia:       "এশিয়া",
  europe:     "ইউরোপ",
  america:    "আমেরিকা",
  middleeast: "মধ্যপ্রাচ্য",
  /* বাণিজ্য */
  stock:      "শেয়ারবাজার",
  bank:       "ব্যাংক",
  economy:    "অর্থনীতি",
  trade:      "বাণিজ্য",
  /* প্রযুক্তি */
  mobile:     "মোবাইল",
  gadget:     "গ্যাজেট",
  software:   "সফটওয়্যার",
  ai:         "এআই",
  startup:    "স্টার্টআপ",
  /* বিনোদন */
  bollywood:  "বলিউড",
  tollywood:  "টলিউড",
  dhallywood: "ধলিউড",
  music:      "সংগীত",
  film:       "চলচ্চিত্র",
  drama:      "নাটক",
  /* জীবনযাপন */
  food:       "খাবার",
  travel:     "ভ্রমণ",
  fashion:    "ফ্যাশন",
  health_tip: "স্বাস্থ্য",
  relationship: "সম্পর্ক",
  /* চাকরি */
  govt_job:   "সরকারি চাকরি",
  private_job:"বেসরকারি চাকরি",
  bank_job:   "ব্যাংক চাকরি",
  result:     "ফলাফল",
  admit:      "ভর্তি"
};

function pickCategoryFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    for (const m of SLUG_TO_CAT) {
      if (parts.includes(m.slug)) return m.cat;
    }
    return null;
  } catch { return null; }
}

function pickSubcategoryFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    for (const m of SLUG_TO_CAT) {
      const idx = parts.indexOf(m.slug);
      if (idx >= 0) {
        const next = parts[idx + 1];
        if (next && SLUG_TO_SUBCAT[next]) return SLUG_TO_SUBCAT[next];
        if (m.slug === "video") return "ভিডিও";
      }
    }
    return null;
  } catch { return null; }
}

/* ===== RSS feed helpers (Prothom Alo /feed/ is server-rendered) ===== */
function decodeXmlEntities(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
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

async function fetchFeed() {
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml" }
  });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  return await res.text();
}

/* প্রতি category-র জন্য সর্বশেষ PER_CATEGORY_LIMIT সংখ্যক item */
function groupItemsByCategory(xml) {
  const items = pickAllItems(xml);
  const grouped = {};
  for (const block of items) {
    const link = pickTag(block, "link");
    if (!link) continue;
    const cat = pickCategoryFromUrl(link);
    if (!cat) continue;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      title:    pickTag(block, "title") || "",
      link,
      pubDate:  pickTag(block, "pubDate") || "",
      image:    pickAttr(block, "media:content", "url")
              || pickAttr(block, "media:thumbnail", "url")
              || null,
      category: cat
    });
  }
  return grouped;
}

/* ===== Summarize: take first ~420 chars at sentence boundary ===== */
function summarize(text, max = MAX_SUMMARY_CHARS) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(
    cut.lastIndexOf("। "),
    cut.lastIndexOf("।"),
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? ")
  );
  if (lastStop > 100) return clean.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return clean.slice(0, lastSpace > 100 ? lastSpace : max).trim() + "…";
}

/* ===== Fetch + parse one article ===== */
async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow"
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");
    const image = pickMeta(html, "og:image") || pickMeta(html, "twitter:image");
    const body  = pickArticleBody(html);
    const video = toEmbedUrl(pickVideoUrl(html));
    const gallery = pickGalleryImages(html, image);
    if (!title) return null;
    return {
      title: title.replace(/\s*[-|]\s*Prothom Alo\s*$/i, "").trim(),
      image,
      gallery: gallery.length > 0 ? JSON.stringify(gallery) : null,
      summary: summarize(body) || pickMeta(html, "og:description"),
      video,
      category:    pickCategoryFromUrl(url),
      subcategory: pickSubcategoryFromUrl(url),
      link: url
    };
  } catch { return null; }
}

async function insertNews({ title, category, image, gallery, details, video, subcategory }) {
  const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const r = await run(
    "INSERT INTO news (title, category, subcategory, details, image, gallery, video, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    title, category, subcategory || null, details, image || null, gallery || null, video || null, time
  );
  return r.lastInsertRowid;
}

/* ===== Vercel Cron handler ===== */
export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const provided =
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") ||
    (req.query && req.query.secret) ||
    "";
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    /* 1. মূল RSS feed থেকে সব category-র article URLs */
    const xml = await fetchFeed();
    const grouped = groupItemsByCategory(xml);

    const totalFetched = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
    if (totalFetched === 0) {
      return res.status(200).json({ ok: true, added: 0, message: "No items in feed" });
    }

    /* 2. Flatten + fetch all article pages in parallel (4 at a time) */
    const flat = [];
    for (const cat of Object.keys(grouped)) {
      for (const it of grouped[cat]) flat.push(it);
    }
    const articles = [];
    for (let i = 0; i < flat.length; i += 4) {
      const batch = await Promise.all(flat.slice(i, i + 4).map(it => fetchArticle(it.link)));
      for (const a of batch) if (a) articles.push(a);
    }
    if (articles.length === 0) {
      return res.status(200).json({ ok: true, added: 0, message: "No article data could be parsed" });
    }

    /* 3. Insert or self-heal each */
    const added = [];
    const skipped = [];
    const byCategory = {};
    for (const it of articles) {
      const cat = it.category || "সর্বশেষ";
      const details = it.summary
        ? `${it.summary}\n\n— সারসংক্ষেপ: ${it.link}`
        : `সূত্র: ${it.link}`;

      const existing = await get(
        "SELECT id, details, video, subcategory FROM news WHERE title = ? LIMIT 1",
        it.title
      );
      if (existing) {
        const needsDetails = (existing.details || "").length < 200 && it.summary;
        const needsVideo   = !existing.video && it.video;
        const needsSub     = !existing.subcategory && it.subcategory;
        if (needsDetails || needsVideo || needsSub) {
          const newDetails = needsDetails
            ? `${it.summary}\n\n— সারসংক্ষেপ: ${it.link}`.slice(0, 2000)
            : existing.details;
          const newVideo = needsVideo ? it.video : existing.video;
          const newSub   = needsSub   ? it.subcategory : existing.subcategory;
          const newGallery = (!existing.gallery && it.gallery) ? it.gallery : existing.gallery;
          await run(
            "UPDATE news SET details = ?, video = ?, subcategory = ?, gallery = ? WHERE id = ?",
            newDetails, newVideo, newSub, newGallery, existing.id
          );
          added.push({ id: existing.id, title: it.title, category: cat, action: "updated" });
        } else {
          skipped.push({ id: existing.id, title: it.title, reason: "duplicate" });
        }
        continue;
      }
      try {
        const id = await insertNews({
          title:       it.title,
          category:    cat,
          image:       it.image,
          gallery:     it.gallery,
          details:     details.slice(0, 2000),
          video:       it.video,
          subcategory: it.subcategory
        });
        added.push({
          id, title: it.title, category: cat,
          summaryLen: it.summary ? it.summary.length : 0,
          video: !!it.video, sub: it.subcategory || null
        });
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      } catch (err) {
        skipped.push({ title: it.title, reason: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      source: "Prothom Alo RSS (all categories, summarized to 420 chars)",
      fetched: totalFetched,
      parsed: articles.length,
      added: added.length,
      skipped: skipped.length,
      byCategory,
      addedItems: added,
      skippedItems: skipped
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
