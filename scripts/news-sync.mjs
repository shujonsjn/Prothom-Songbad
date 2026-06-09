import puppeteer from "puppeteer";
import { createClient } from "@libsql/client";

const FEED_URL    = "https://www.prothomalo.com/feed/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
if (!tursoUrl) { console.error("TURSO_URL not set"); process.exit(1); }
const client = createClient({ url: tursoUrl, authToken: tursoToken });

const SLUG_TO_CAT = {
  "national": "জাতীয়", "politics": "রাজনীতি", "economy": "অর্থনীতি",
  "international": "আন্তর্জাতিক", "sports": "খেলা", "entertainment": "বিনোদন",
  "lifestyle": "জীবনযাপন", "tech": "টেক", "education": "শিক্ষা",
  "health": "স্বাস্থ্য", "environment": "পরিবেশ", "opinion": "মতামত",
  "feature": "ফিচার", "religion": "ধর্ম", "crime": "অপরাধ",
  "accident": "দুর্ঘটনা", "district": "জেলা", "country": "দেশ",
  "science": "বিজ্ঞান", "agriculture": "কৃষি",
};

const SLUG_TO_SUBCAT = {
  "football": "ফুটবল", "cricket": "ক্রিকেট", "tennis": "টেনিস",
  "badminton": "ব্যাডমিন্টন", "athletics": "অ্যাথলেটিক্স",
  "movies": "সিনেমা", "music": "সংগীত", "tv": "টেলিভিশন",
  "travel": "ভ্রমণ", "food": "খাবার", "fashion": "ফ্যাশন",
  "business": "ব্যবসা", "startup": "স্টার্টআপ", "stock": "শেয়ারবাজার",
  "dhaka": "ঢাকা", "chattogram": "চট্টগ্রাম", "sylhet": "সিলেট",
  "rajshahi": "রাজশাহী", "khulna": "খুলনা", "barishal": "বরিশাল",
  "r-angpur": "রংপুর", "mymensingh": "ময়মনসিংহ",
};

function pickSlug(url, prefix) {
  if (!url) return null;
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean);
  for (const s of seg) {
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return null;
}

function pickCategory(url) {
  for (const [slug, cat] of Object.entries(SLUG_TO_CAT)) {
    if (url && url.includes("/" + slug + "/")) return cat;
  }
  return "সর্বশেষ";
}

function pickSubcategory(url) {
  for (const [slug, sub] of Object.entries(SLUG_TO_SUBCAT)) {
    if (url && url.includes("/" + slug + "/")) return sub;
  }
  return null;
}

function decodeEntities(s) {
  if (!s) return "";
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
    .replace(/&#x([\da-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function pickAttr(block, tag, attr) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1].trim() : null;
}

function extractItems(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const link = pickTag(block, "link");
    if (!link) continue;
    items.push({
      title: decodeEntities(pickTag(block, "title") || "").trim(),
      link: link.trim(),
      description: decodeEntities(pickTag(block, "description") || "").trim(),
      image: pickAttr(block, "media:content", "url") || pickAttr(block, "media:thumbnail", "url") || null,
      category: pickCategory(link),
      subcategory: pickSubcategory(link),
    });
  }
  return items;
}

function summarize(text, max = 500) {
  if (!text) return null;
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  for (const sep of ["। ", "।", ". ", "\n\n"]) {
    const idx = slice.lastIndexOf(sep);
    if (idx > 100) return slice.slice(0, idx + sep.trim().length);
  }
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > 100 ? slice.slice(0, lastSpace) + "…" : slice + "…";
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta\\s[^>]*?(?:property|name)\\s*=\\s*["']${name}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta\\s[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${name}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractJsonLd(html) {
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractArticleBody(html) {
  const ld = extractJsonLd(html);
  if (ld && ld.articleBody) return ld.articleBody;
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchPageHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return res.text();
}

async function setupDB() {
  await client.execute(`CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    category TEXT NOT NULL, subcategory TEXT, details TEXT NOT NULL,
    image TEXT, video TEXT, time TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
  try { await client.execute("ALTER TABLE news ADD COLUMN video TEXT"); } catch {}
  try { await client.execute("ALTER TABLE news ADD COLUMN subcategory TEXT"); } catch {}
}

async function insertNews({ title, category, subcategory, details, image, video }) {
  const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const r = await client.execute({
    sql: "INSERT INTO news (title, category, subcategory, details, image, video, time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [title, category, subcategory || null, details, image || null, video || null, time],
  });
  return Number(r.lastInsertRowid);
}

async function findExisting(title) {
  const r = await client.execute({
    sql: "SELECT id, details, video, subcategory FROM news WHERE title = ?",
    args: [title],
  });
  return r.rows && r.rows[0] ? r.rows[0] : null;
}

async function updateNews(id, { details, image, video, subcategory }) {
  const updates = [];
  const args = [];
  if (details !== undefined) { updates.push("details = ?"); args.push(details); }
  if (image !== undefined) { updates.push("image = ?"); args.push(image); }
  if (video !== undefined) { updates.push("video = ?"); args.push(video); }
  if (subcategory !== undefined) { updates.push("subcategory = ?"); args.push(subcategory); }
  if (updates.length === 0) return;
  args.push(id);
  await client.execute({
    sql: `UPDATE news SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });
}

async function takeScreenshot(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
    await new Promise(r => setTimeout(r, 1000));
    const buf = await page.screenshot({ type: "jpeg", quality: 80, fullPage: false });
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch (err) {
    console.error("  Screenshot failed:", url, err.message);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  console.log("Starting news sync …");
  await setupDB();

  /* 1. Fetch RSS */
  console.log("Fetching RSS feed …");
  const feedRes = await fetch(FEED_URL, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml" },
    signal: AbortSignal.timeout(30000),
  });
  if (!feedRes.ok) { console.error("Feed fetch failed:", feedRes.status); process.exit(1); }
  const xml = await feedRes.text();
  const allItems = extractItems(xml);
  console.log(`Found ${allItems.length} items in feed`);

  if (allItems.length === 0) { console.log("No items found"); return; }

  /* 2. Launch Puppeteer */
  console.log("Launching browser …");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const added = [];
  const skipped = [];

  for (const [idx, item] of allItems.entries()) {
    console.log(`[${idx + 1}/${allItems.length}] ${item.title.slice(0, 60)}…`);

    /* Fetch article HTML for metadata */
    let html = null;
    try { html = await fetchPageHTML(item.link); } catch {}
    if (!html) { skipped.push({ title: item.title, reason: "HTML fetch failed" }); continue; }

    const ogTitle = extractMeta(html, "og:title") || item.title;
    const cleanTitle = ogTitle.replace(/\s*[-–—|]\s*Prothom Alo.*$/i, "").trim();

    /* Check existing */
    const existing = await findExisting(cleanTitle);
    if (existing && existing.details && existing.details.length > 200 && existing.image) {
      console.log("  → Already exists with good data, skipping");
      skipped.push({ title: cleanTitle, reason: "exists" });
      continue;
    }

    /* Take screenshot for clean image */
    console.log("  → Taking screenshot …");
    const ss = await takeScreenshot(browser, item.link);

    /* Extract article body + summarize */
    const body = extractArticleBody(html);
    const summary = summarize(body);
    const ogImage = extractMeta(html, "og:image");
    const ogDesc = extractMeta(html, "og:description");
    const finalSummary = summary || ogDesc || `সূত্র: ${item.link}`;
    const cleanImage = ss || ogImage || item.image;
    let videoUrl = null;
    const vRe = html.match(/(?:src|href)\s*=\s*["']([^"']*(?:youtube\.com|youtu\.be|facebook\.com)[^"']*)["']/i);
    if (vRe) videoUrl = vRe[1];

    const details = `${finalSummary}\n\n— সারসংক্ষেপ: ${item.link}`;

    if (existing) {
      /* Self-heal: update missing fields */
      await updateNews(existing.id, {
        details: !existing.details || existing.details.length < 200 ? details : undefined,
        image: !existing.image ? cleanImage : undefined,
        video: !existing.video ? videoUrl : undefined,
        subcategory: !existing.subcategory ? item.subcategory : undefined,
      });
      console.log("  → Updated (self-heal)");
      added.push({ title: cleanTitle, id: existing.id, action: "updated" });
    } else {
      const id = await insertNews({
        title: cleanTitle,
        category: item.category,
        subcategory: item.subcategory,
        details,
        image: cleanImage,
        video: videoUrl,
      });
      console.log("  → Inserted id=" + id);
      added.push({ title: cleanTitle, id, action: "inserted" });
    }
  }

  await browser.close();
  console.log(`\nDone. Added/updated: ${added.length}, Skipped: ${skipped.length}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
