/* scripts/news-sync.mjs
   GitHub Actions-এ চলে। RSS feed থেকে article link নিয়ে Puppeteer দিয়ে
   screenshot নিয়ে Vercel API-র মাধ্যমে DB-তে সংরক্ষণ করে।
   Vercel endpoint: POST /api/cron-update-screenshot (CRON_SECRET protected)
*/

import puppeteer from "puppeteer";

const FEED_URL = "https://www.prothomalo.com/feed/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const API = process.env.API_URL || "https://prothom-songbad.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) { console.error("CRON_SECRET not set"); process.exit(1); }

function extractItems(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
    const titleRaw = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    if (!link) continue;
    const title = (titleRaw || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
      .trim();
    items.push({ title, link: link.trim() });
  }
  return items;
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
    console.error("  Screenshot failed:", err.message);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function sendImageToVercel(title, imageData, link) {
  try {
    const res = await fetch(`${API}/api/cron-update-screenshot?secret=${CRON_SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, image: imageData, link }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: j };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log("Fetching RSS feed …");
  const feedRes = await fetch(FEED_URL, {
    headers: { "User-Agent": UA, "Accept": "application/rss+xml, text/xml" },
    signal: AbortSignal.timeout(30000),
  });
  if (!feedRes.ok) { console.error("Feed fetch failed:", feedRes.status); process.exit(1); }
  const xml = await feedRes.text();

  const items = extractItems(xml);
  console.log(`Found ${items.length} items`);

  if (items.length === 0) return;

  console.log("Launching browser …");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  let ok = 0, fail = 0;

  for (const [idx, item] of items.entries()) {
    console.log(`[${idx + 1}/${items.length}] ${(item.title || item.link).slice(0, 60)}…`);
    const ss = await takeScreenshot(browser, item.link);
    if (!ss) { fail++; continue; }
    const result = await sendImageToVercel(item.title, ss, item.link);
    if (result.ok) {
      console.log("  → Sent to API: " + (result.body.message || "ok"));
      ok++;
    } else {
      console.error("  → API error:", result.status, JSON.stringify(result.body));
      fail++;
    }
  }

  await browser.close();
  console.log(`\nDone. Screenshots sent: ${ok}, Failed: ${fail}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
