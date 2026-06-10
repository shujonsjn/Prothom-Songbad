/* ==========================================================
   api/index.js — Vercel serverless function (self-contained)
   Contains both the DB layer and the Express app inline,
   so Vercel's @vercel/node builder bundles all dependencies
   correctly. This is the production entry point.
   For local development, run `node backend/server.js`.
   ========================================================== */

import express from "express";
import multer from "multer";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/* ===== DB layer (Turso if env vars set, else local file) ===== */
const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: "file:./data.db" });

class Statement {
  constructor(sql) { this.sql = sql; }
  async all(...args) {
    const r = await client.execute({ sql: this.sql, args });
    return r.rows || [];
  }
  async get(...args) {
    const r = await client.execute({ sql: this.sql, args });
    return r.rows && r.rows[0] ? r.rows[0] : null;
  }
  async run(...args) {
    const r = await client.execute({ sql: this.sql, args });
    return {
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined,
      changes: r.rowsAffected
    };
  }
}
class DB {
  prepare(sql) { return new Statement(sql); }
  async exec(sql) { await client.execute(sql); }
}
const db = new DB();

let schemaReady = (async () => {
  await db.exec(`
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
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS news_images (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id    INTEGER NOT NULL,
      image_url  TEXT    NOT NULL,
      caption    TEXT    DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_news_images_news ON news_images(news_id, sort_order)"); } catch {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      name       TEXT PRIMARY KEY,
      sort_order INTEGER DEFAULT 0,
      hidden     INTEGER DEFAULT 0
    )
  `);
  /* self-healing migration for older deployments */
  try { await db.exec("ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {}
  try { await db.exec("ALTER TABLE categories ADD COLUMN hidden INTEGER DEFAULT 0"); } catch {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      category   TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, name)
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id    INTEGER,
      path       TEXT    NOT NULL,
      ref        TEXT,
      ua         TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at)"); } catch {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_pv_news    ON page_views(news_id)"); } catch {}
  try { await db.exec("ALTER TABLE page_views ADD COLUMN ip TEXT"); } catch {}
  try { await db.exec("ALTER TABLE page_views ADD COLUMN country TEXT"); } catch {}

  /* ===== Admin profile table (so admin can change username/password from UI) ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT    UNIQUE NOT NULL,
      password     TEXT    NOT NULL,
      display_name TEXT,
      role         TEXT    DEFAULT 'admin',
      email        TEXT,
      phone        TEXT,
      last_login   DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  /* self-healing migration for older deployments (adds email/phone to existing rows) */
  try { await db.exec("ALTER TABLE admins ADD COLUMN email TEXT"); } catch {}
  try { await db.exec("ALTER TABLE admins ADD COLUMN phone TEXT"); } catch {}
  try { await db.exec("ALTER TABLE admins ADD COLUMN avatar TEXT"); } catch {}

  /* ===== Inbox (incoming email from Cloudflare Email Routing / others) ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      direction    TEXT    DEFAULT 'inbound',
      from_email   TEXT,
      from_name    TEXT,
      to_email     TEXT,
      subject      TEXT,
      snippet      TEXT,
      body_text    TEXT,
      body_html    TEXT,
      message_id   TEXT,
      in_reply_to  TEXT,
      headers_json TEXT,
      source       TEXT,
      read         INTEGER DEFAULT 0,
      starred      INTEGER DEFAULT 0,
      archived     INTEGER DEFAULT 0,
      spam         INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages(created_at DESC)"); } catch {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_msgid   ON inbox_messages(message_id)"); } catch {}

  /* ===== Banners / Ads ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS banners (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      position    TEXT    NOT NULL,
      title       TEXT,
      image_url   TEXT    NOT NULL,
      link_url    TEXT,
      active      INTEGER DEFAULT 1,
      sort_order  INTEGER DEFAULT 0,
      width       INTEGER,
      height      INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_banners_pos ON banners(position, active, sort_order)"); } catch {}
  try { await db.exec("ALTER TABLE banners ADD COLUMN width INTEGER"); } catch {}
  try { await db.exec("ALTER TABLE banners ADD COLUMN height INTEGER"); } catch {}

  /* ===== Subscribers ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL DEFAULT '',
      phone        TEXT    NOT NULL DEFAULT '',
      email        TEXT,
      password     TEXT,
      source       TEXT    DEFAULT 'website',
      active       INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_subscribers_created ON subscribers(created_at DESC)"); } catch {}
  try { await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email)"); } catch {}
  /* self-healing: add columns for older DBs */
  try { await db.exec("ALTER TABLE subscribers ADD COLUMN name TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.exec("ALTER TABLE subscribers ADD COLUMN phone TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.exec("ALTER TABLE subscribers ADD COLUMN password TEXT"); } catch {}
  try { await db.exec("ALTER TABLE subscribers ADD COLUMN address TEXT DEFAULT ''"); } catch {}
  try { await db.exec("ALTER TABLE subscribers ADD COLUMN avatar TEXT DEFAULT ''"); } catch {}

  /* ===== Notifications (admin → subscribers email campaigns) ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      message      TEXT    NOT NULL,
      category     TEXT    DEFAULT '',
      scheduled_at DATETIME,
      sent         INTEGER DEFAULT 0,
      sent_at      DATETIME,
      recipient_count INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_sent ON notifications(sent)"); } catch {}

  /* ===== Comments (subscriber comments on news articles) ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id      INTEGER NOT NULL,
      subscriber_name TEXT NOT NULL,
      subscriber_email TEXT NOT NULL,
      body         TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_comments_news ON comments(news_id, created_at DESC)"); } catch {}

  /* ===== Password resets ===== */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used       INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)"); } catch {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email)"); } catch {}

  /* First run: seed default admin from env vars (bcrypt-hashed). Existing
     DBs won't be touched. */
  const adminCount = await db.prepare("SELECT COUNT(*) AS c FROM admins").get();
  if ((adminCount?.c || 0) === 0) {
    const seedUser = process.env.ADMIN_USER || "admin";
    const seedPass = process.env.ADMIN_PASS || "1234";
    const seedHash = await bcrypt.hash(seedPass, 10);
    const seedName = process.env.ADMIN_DISPLAY_NAME || "Editor";
    await db.prepare(
      "INSERT INTO admins (username, password, display_name, role) VALUES (?, ?, ?, ?)"
    ).run(seedUser, seedHash, seedName, "admin");
    console.log("[admins] seeded default admin user from env");
  }
  /* পুরনো টেবিলে column নাও থাকতে পারে — যোগ করার চেষ্টা করি */
  try { await db.exec("ALTER TABLE news ADD COLUMN video TEXT"); } catch {}
  try { await db.exec("ALTER TABLE news ADD COLUMN subcategory TEXT"); } catch {}
  const existing = await db.prepare(
    "SELECT DISTINCT category FROM news WHERE category IS NOT NULL AND category != ''"
  ).all();
  for (const r of existing) {
    if (r.category) {
      /* use order: main categories first, then others */
      const order = (r.category === "খেলা" || r.category === "জাতীয়" || r.category === "আন্তর্জাতিক" || r.category === "বিনোদন" || r.category === "প্রযুক্তি") ? 0 : 999;
      await db.prepare("INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)").run(r.category, order);
    }
  }
  /* one-time sort normalization: ensure all categories have a proper sort_order */
  const noOrder = await db.prepare("SELECT COUNT(*) AS c FROM categories WHERE sort_order IS NULL OR sort_order = 0").get();
  if ((noOrder?.c || 0) > 0) {
    const all = await db.prepare("SELECT name FROM categories ORDER BY sort_order ASC, name ASC").all();
    let i = 0;
    for (const r of all) {
      await db.prepare("UPDATE categories SET sort_order = ? WHERE name = ?").run(i++, r.name);
    }
  }

  /* প্রথমবার চললে hardcoded default sub-categories seed করি */
  const subCount = await db.prepare("SELECT COUNT(*) AS c FROM subcategories").get();
  if ((subCount?.c || 0) === 0 && process.env.SEED_SUBCATS !== "0") {
    const defaults = {
      "খেলা": [
        "ক্রিকেট", "ফুটবল", "টেনিস", "জানা খেলা", "সাফখেলাস",
        "সড়ক দৌড়", "কুইব", "সাত রং", "ভিডিও", "আর্কাইভ খেলা"
      ],
      "জাতীয়": [
        "রাজনীতি", "সরকার", "সংসদ", "আইন-আদালত", "অপরাধ",
        "শিক্ষা", "স্বাস্থ্য", "পরিবেশ"
      ],
      "আন্তর্জাতিক": [
        "এশিয়া", "ইউরোপ", "আমেরিকা", "মধ্যপ্রাচ্য", "আফ্রিকা", "ওশেনিয়া"
      ],
      "বিনোদন": [
        "চলচ্চিত্র", "গান", "নাটক", "সিরিজ", "টেলিভিশন",
        "বলিউড", "হলিউড", "দক্ষিণী", "কোরীয়"
      ],
      "Binodon": [
        "চলচ্চিত্র", "গান", "নাটক", "সিরিজ", "টেলিভিশন",
        "বলিউড", "হলিউড", "দক্ষিণী", "কোরীয়"
      ],
      "প্রযুক্তি": [
        "মোবাইল", "কম্পিউটার", "সফটওয়্যার", "গেমস", "ইন্টারনেট", "এআই"
      ]
    };
    for (const [cat, names] of Object.entries(defaults)) {
      for (const n of names) {
        await db.prepare(
          "INSERT OR IGNORE INTO subcategories (category, name) VALUES (?, ?)"
        ).run(cat, n);
      }
    }
  }
})();
async function ready() { await schemaReady; }

/* ===== Express app ===== */
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* Basic auth — checks DB admins table first, falls back to env vars */
async function checkCreds(user, pass){
  if (!user) return null;
  try {
    const row = await db.prepare(
      "SELECT id, username, password, display_name, role FROM admins WHERE username = ?"
    ).get(user);
    if (row) {
      const ok = await bcrypt.compare(pass || "", row.password || "");
      return ok ? row : null;
    }
  } catch (e) {
    console.error("[auth] DB check failed:", e.message);
  }
  /* fallback: env-var single admin (only if env-pass is set AND no DB row) */
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return { id: 0, username: ADMIN_USER, display_name: "Editor", role: "admin", _env: true };
  }
  return null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin", charset="UTF-8"');
    return res.status(401).json({ error: "Authentication required" });
  }
  let user, pass;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    user = decoded.slice(0, idx);
    pass = decoded.slice(idx + 1);
  } catch {
    return res.status(401).json({ error: "Malformed credentials" });
  }
  checkCreds(user, pass).then(row => {
    if (row) {
      req.admin = row;
      /* best-effort: update last_login (fire-and-forget) */
      if (!row._env) {
        db.prepare("UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?")
          .run(row.id).catch(() => {});
      }
      return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Admin", charset="UTF-8"');
    return res.status(401).json({ error: "Invalid credentials" });
  }).catch(err => {
    console.error("[auth] error:", err);
    return res.status(500).json({ error: "Auth error" });
  });
}

/* Multer (memory storage for serverless) */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image and video files are allowed"));
  }
});
function fileToDataUrl(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

function parseArticleImages(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((img, i) => ({
      image_url: String(img.image_url || "").trim(),
      caption: String(img.caption || "").trim(),
      sort_order: typeof img.sort_order === "number" ? img.sort_order : i
    })).filter(img => img.image_url && /^https?:\/\//.test(img.image_url));
  } catch { return []; }
}

/* ===== Public API ===== */
app.get("/api/news", async (req, res) => {
  try {
    const category = (req.query.category || "").toString().trim();
    const subcategory = (req.query.sub || req.query.subcategory || "").toString().trim();
    const limit = Math.min(Number(req.query.limit) || 0, 100);
    const where = [];
    const args  = [];
    if (category && category !== "all") {
      where.push("category = ?");
      args.push(category);
    }
    if (subcategory) {
      where.push("subcategory = ?");
      args.push(subcategory);
    }
    const base = where.length
      ? `SELECT * FROM news WHERE ${where.join(" AND ")} ORDER BY id DESC`
      : "SELECT * FROM news ORDER BY id DESC";
    const sql = limit > 0 ? `${base} LIMIT ?` : base;
    if (limit > 0) args.push(limit);
    const rows = await db.prepare(sql).all(...args);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/news/:id", async (req, res) => {
  try {
    const row = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "News not found" });
    const images = await db.prepare(
      "SELECT id, image_url, caption, sort_order FROM news_images WHERE news_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(req.params.id);
    row.article_images = images;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const includeHidden = req.query.includeHidden === "1";
    const hiddenFilter = includeHidden ? "" : "WHERE c.hidden = 0";
    const rows = await db.prepare(`
      SELECT c.name AS category, c.sort_order, c.hidden, COUNT(n.id) AS count
      FROM categories c
      LEFT JOIN news n ON n.category = c.name
      ${hiddenFilter}
      GROUP BY c.name
      ORDER BY c.sort_order ASC, count DESC, c.name ASC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Reorder categories — body: [{name, sort_order}] */
app.put("/api/categories/reorder", requireAuth, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.order) ? req.body.order : null;
    if(!list) return res.status(400).json({ error: "Body must be { order: [{name, sort_order}] }" });
    let i = 0;
    for(const item of list){
      const name = String(item.name || "").trim();
      if(!name) continue;
      const order = Number.isFinite(item.sort_order) ? Number(item.sort_order) : i;
      await db.prepare("UPDATE categories SET sort_order = ? WHERE name = ?").run(order, name);
      i++;
    }
    res.json({ ok: true, count: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Toggle category hidden/visible */
app.put("/api/categories/:name/hidden", requireAuth, async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || "").trim();
    const hidden = req.body?.hidden ? 1 : 0;
    if(!name) return res.status(400).json({ error: "name required" });
    const r = await db.prepare("UPDATE categories SET hidden = ? WHERE name = ?").run(hidden, name);
    if(r.changes === 0) return res.status(404).json({ error: "Category not found" });
    res.json({ ok: true, name, hidden });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* subcategories: ?category=xxx দিলে ওই category-র সব sub;
   ছাড়া দিলে সব (grouped)। Format: [{id, category, name, newsCount}] */
app.get("/api/subcategories", async (req, res) => {
  try {
    const cat = (req.query.category || "").toString().trim();
    const sql = `
      SELECT s.id, s.category, s.name,
             (SELECT COUNT(*) FROM news n
                WHERE n.category = s.category
                  AND n.subcategory = s.name) AS newsCount
      FROM subcategories s
      ${cat ? "WHERE s.category = ?" : ""}
      ORDER BY s.category ASC, s.id ASC
    `;
    const rows = cat
      ? await db.prepare(sql).all(cat)
      : await db.prepare(sql).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/subcategories", requireAuth, async (req, res) => {
  try {
    const category = (req.body.category || "").toString().trim();
    const name     = (req.body.name || "").toString().trim();
    if (!category || !name) {
      return res.status(400).json({ error: "category এবং name দুটোই দিতে হবে" });
    }
    if (name.length > 40) return res.status(400).json({ error: "name খুব বড় (max 40)" });
    const catExists = await db.prepare("SELECT 1 FROM categories WHERE name = ?").get(category);
    if (!catExists) return res.status(404).json({ error: `“${category}” ক্যাটাগরি নেই` });
    try {
      const r = await db.prepare(
        "INSERT INTO subcategories (category, name) VALUES (?, ?)"
      ).run(category, name);
      const row = await db.prepare("SELECT * FROM subcategories WHERE id = ?").get(r.lastInsertRowid);
      res.status(201).json(row);
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "এই sub-category আগে থেকেই আছে" });
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/subcategories/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const used = await db.prepare(
      "SELECT COUNT(*) AS c FROM news WHERE subcategory = (SELECT name FROM subcategories WHERE id = ?) AND category = (SELECT category FROM subcategories WHERE id = ?)"
    ).get(id, id);
    if (used.c > 0) {
      return res.status(409).json({
        error: `এই sub-category তে ${used.c}টি সংবাদ আছে — আগে সেগুলো মুছুন`
      });
    }
    const r = await db.prepare("DELETE FROM subcategories WHERE id = ?").run(id);
    if (r.changes === 0) return res.status(404).json({ error: "Sub-category not found" });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/categories", requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "Category name is required" });
    if (name.length > 40) return res.status(400).json({ error: "Name too long (max 40)" });
    const exists = await db.prepare("SELECT 1 FROM categories WHERE name = ?").get(name);
    if (exists) return res.status(409).json({ error: "Category already exists" });
    /* assign next sort_order (max+1) so new categories append to the bottom */
    const maxOrder = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").get();
    const nextOrder = (maxOrder?.m ?? -1) + 1;
    await db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)").run(name, nextOrder);
    res.status(201).json({ ok: true, name, sort_order: nextOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:name", requireAuth, async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || "").trim();
    if (!name) return res.status(400).json({ error: "Category name is required" });
    const used = await db.prepare("SELECT COUNT(*) AS c FROM news WHERE category = ?").get(name);
    if (used.c > 0) {
      return res.status(409).json({
        error: `“${name}” ক্যাটাগরিতে ${used.c}টি সংবাদ আছে — আগে সেগুলো মুছুন বা অন্য ক্যাটাগরিতে সরান`
      });
    }
    await db.prepare("DELETE FROM subcategories WHERE category = ?").run(name);
    const r = await db.prepare("DELETE FROM categories WHERE name = ?").run(name);
    if (r.changes === 0) return res.status(404).json({ error: "Category not found" });
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Banners / Ads ===== */
const ALLOWED_BANNER_POS = ["sidebar-bottom", "sidebar-top", "header", "footer", "inline", "nav-bottom"];
app.get("/api/banners", async (req, res) => {
  await ready();
  try {
    const pos = (req.query.position || "").trim();
    const sql = pos
      ? "SELECT id, position, title, image_url, link_url, active, sort_order, width, height, created_at FROM banners WHERE position = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
      : "SELECT id, position, title, image_url, link_url, active, sort_order, width, height, created_at FROM banners ORDER BY position ASC, sort_order ASC, id ASC";
    const args = pos ? [pos] : [];
    const rows = await db.prepare(sql).all(...args);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/banners", requireAuth, async (req, res) => {
  await ready();
  try {
    const { position, title, image_url, link_url, active, sort_order, width, height } = req.body || {};
    if (!position || !ALLOWED_BANNER_POS.includes(position)) {
      return res.status(400).json({ error: "Invalid position" });
    }
    if (!image_url || !String(image_url).trim()) {
      return res.status(400).json({ error: "Image URL দিতে হবে" });
    }
    const r = await db.prepare(
      "INSERT INTO banners (position, title, image_url, link_url, active, sort_order, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      position,
      (title || "").trim().slice(0, 200) || null,
      String(image_url).trim(),
      (link_url || "").trim().slice(0, 500) || null,
      active === false || active === 0 ? 0 : 1,
      Number(sort_order) || 0,
      width  ? Number(width)  : null,
      height ? Number(height) : null
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/banners/:id", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const cur = await db.prepare("SELECT * FROM banners WHERE id = ?").get(id);
    if (!cur) return res.status(404).json({ error: "Banner not found" });
    const { position, title, image_url, link_url, active, sort_order, width, height } = req.body || {};
    const pos = (position || cur.position);
    if (!ALLOWED_BANNER_POS.includes(pos)) return res.status(400).json({ error: "Invalid position" });
    await db.prepare(
      "UPDATE banners SET position=?, title=?, image_url=?, link_url=?, active=?, sort_order=?, width=?, height=? WHERE id=?"
    ).run(
      pos,
      (title !== undefined ? title : cur.title) || null,
      (image_url || cur.image_url || "").trim(),
      (link_url !== undefined ? link_url : cur.link_url) || null,
      active === undefined ? cur.active : (active === false || active === 0 ? 0 : 1),
      sort_order === undefined ? cur.sort_order : (Number(sort_order) || 0),
      width  === undefined ? cur.width  : (width  ? Number(width)  : null),
      height === undefined ? cur.height : (height ? Number(height) : null),
      id
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/banners/:id", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    const r = await db.prepare("DELETE FROM banners WHERE id = ?").run(id);
    if (r.changes === 0) return res.status(404).json({ error: "Banner not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Subscribers ===== */
app.post("/api/subscribe", async (req, res) => {
  await ready();
  try {
    const { name, phone, email, password } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    if (!phone || !phone.trim()) return res.status(400).json({ error: "Phone is required" });
    if (!email || !email.trim()) return res.status(400).json({ error: "Email is required" });
    if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
    const hash = await bcrypt.hash(password, 10);
    await db.prepare(
      "INSERT INTO subscribers (name, phone, email, password) VALUES (?, ?, ?, ?)"
    ).run(name.trim(), phone.trim(), email.trim().toLowerCase(), hash);
    const row = await db.prepare("SELECT id, name, phone, email, active, created_at, address, avatar FROM subscribers WHERE email = ?").get(email.trim().toLowerCase());
    const token = row.id + ":" + row.email;
    res.json({ subscriber: row, token });
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "This email is already subscribed" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/subscribers", requireAuth, async (req, res) => {
  await ready();
  try {
    const rows = await db.prepare(
      "SELECT * FROM subscribers ORDER BY created_at DESC"
    ).all();
    res.json({ subscribers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/subscribers/export", requireAuth, async (req, res) => {
  await ready();
  try {
    const rows = await db.prepare(
      "SELECT name, phone, email, active, created_at FROM subscribers ORDER BY created_at DESC"
    ).all();
    const esc = v => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    };
    let csv = "Name,Phone,Email,Status,Subscribed At\n";
    for (const r of rows) {
      csv += esc(r.name) + "," + esc(r.phone) + "," + esc(r.email) + "," + (r.active ? "Active" : "Inactive") + "," + esc(r.created_at) + "\n";
    }
    const bom = "\uFEFF";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=subscribers_" + new Date().toISOString().slice(0,10) + ".csv");
    res.send(bom + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Public subscriber lookup & management (password-protected) ===== */
app.post("/api/subscriber/login", async (req, res) => {
  await ready();
  try {
    const { email, password } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    const row = await db.prepare(
      "SELECT id, name, phone, email, active, created_at, password, source, address, avatar FROM subscribers WHERE LOWER(email) = ?"
    ).get(email.trim().toLowerCase());
    if (!row) return res.status(404).json({ error: "Subscriber not found" });
    const ok = await bcrypt.compare(password, row.password || "");
    if (!ok) return res.status(401).json({ error: "Wrong password" });
    const isAdmin = row.source === "admin" ? true : false;
    const { password: _, source: __, ...safe } = row;
    safe.is_admin = isAdmin;
    res.json({ subscriber: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/subscriber/unsubscribe", async (req, res) => {
  await ready();
  try {
    const { email, password } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    const row = await db.prepare("SELECT password FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!row) return res.status(404).json({ error: "Subscriber not found" });
    const ok = await bcrypt.compare(password, row.password || "");
    if (!ok) return res.status(401).json({ error: "Wrong password" });
    await db.prepare("UPDATE subscribers SET active = 0 WHERE LOWER(email) = ?").run(email.trim().toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/subscriber/resubscribe", async (req, res) => {
  await ready();
  try {
    const { email, password } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    const row = await db.prepare("SELECT password FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!row) return res.status(404).json({ error: "Subscriber not found" });
    const ok = await bcrypt.compare(password, row.password || "");
    if (!ok) return res.status(401).json({ error: "Wrong password" });
    await db.prepare("UPDATE subscribers SET active = 1 WHERE LOWER(email) = ?").run(email.trim().toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/subscriber/password", async (req, res) => {
  await ready();
  try {
    const { email, current_password, new_password } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!current_password) return res.status(400).json({ error: "Current password required" });
    if (!new_password || new_password.length < 4) return res.status(400).json({ error: "New password must be at least 4 characters" });
    const row = await db.prepare("SELECT password FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!row) return res.status(404).json({ error: "Subscriber not found" });
    const ok = await bcrypt.compare(current_password, row.password || "");
    if (!ok) return res.status(401).json({ error: "Current password is wrong" });
    const hash = await bcrypt.hash(new_password, 10);
    await db.prepare("UPDATE subscribers SET password = ? WHERE LOWER(email) = ?").run(hash, email.trim().toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/subscriber/profile", async (req, res) => {
  await ready();
  try {
    const { email, password, name, phone, address, avatar } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
    const row = await db.prepare("SELECT password FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!row) return res.status(404).json({ error: "Subscriber not found" });
    const ok = await bcrypt.compare(password, row.password || "");
    if (!ok) return res.status(401).json({ error: "Wrong password" });
    await db.prepare("UPDATE subscribers SET name = ?, phone = ?, address = ?, avatar = ? WHERE LOWER(email) = ?")
      .run(name.trim(), (phone || "").trim(), (address || "").trim(), (avatar || "").trim(), email.trim().toLowerCase());
    const updated = await db.prepare("SELECT id, name, phone, email, active, created_at, address, avatar FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    res.json({ subscriber: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/subscriber/profile", async (req, res) => {
  await ready();
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email required" });
    const row = await db.prepare("SELECT id, name, phone, email, active, created_at, address, avatar FROM subscribers WHERE LOWER(email) = ?").get(email);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ subscriber: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Password reset (forgot password) ===== */
app.post("/api/subscriber/forgot-password", async (req, res) => {
  await ready();
  try {
    const { email } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    const sub = await db.prepare("SELECT id, name FROM subscribers WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!sub) return res.status(404).json({ error: "এই ইমেইলে কোনো সাবস্ক্রাইবার পাওয়া যায়নি" });
    /* generate 6-digit code */
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString(); /* 30 min */
    await db.prepare(
      "INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)"
    ).run(email.trim().toLowerCase(), token, expiresAt);
    /* In production this would be emailed. For now, return token so UI can display it. */
    res.json({ ok: true, message: "আপনার ইমেইলে একটি রিসেট কোড পাঠানো হয়েছে", token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/subscriber/reset-password", async (req, res) => {
  await ready();
  try {
    const { email, token, new_password } = req.body || {};
    if (!email || !email.trim()) return res.status(400).json({ error: "Email required" });
    if (!token) return res.status(400).json({ error: "Reset code required" });
    if (!new_password || new_password.length < 4) return res.status(400).json({ error: "New password must be at least 4 characters" });
    const row = await db.prepare(
      "SELECT id FROM password_resets WHERE LOWER(email) = ? AND token = ? AND used = 0 AND expires_at > datetime('now')"
    ).get(email.trim().toLowerCase(), token.trim());
    if (!row) return res.status(401).json({ error: "Invalid or expired reset code" });
    const hash = await bcrypt.hash(new_password, 10);
    await db.prepare("UPDATE subscribers SET password = ? WHERE LOWER(email) = ?").run(hash, email.trim().toLowerCase());
    await db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(row.id);
    res.json({ ok: true, message: "পাসওয়ার্ড রিসেট সফল! এখন লগইন করুন।" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Comments (subscriber comments on news articles) ===== */
app.get("/api/comments", async (req, res) => {
  await ready();
  try {
    const newsId = Number(req.query.news_id);
    if (!newsId) return res.status(400).json({ error: "news_id required" });
    const rows = await db.prepare(
      "SELECT id, news_id, subscriber_name, subscriber_email, body, created_at FROM comments WHERE news_id = ? ORDER BY created_at DESC"
    ).all(newsId);
    res.json({ comments: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/comments", async (req, res) => {
  await ready();
  try {
    const { news_id, email, body } = req.body || {};
    if (!news_id) return res.status(400).json({ error: "news_id required" });
    if (!email || !email.trim()) return res.status(400).json({ error: "Login required to comment" });
    if (!body || !body.trim()) return res.status(400).json({ error: "Comment body required" });
    const newsExists = await db.prepare("SELECT 1 FROM news WHERE id = ?").get(news_id);
    if (!newsExists) return res.status(404).json({ error: "নিউজটি খুঁজে পাওয়া যায়নি" });
    /* verify subscriber exists and is active */
    const sub = await db.prepare(
      "SELECT name, active FROM subscribers WHERE LOWER(email) = ?"
    ).get(email.trim().toLowerCase());
    if (!sub) return res.status(401).json({ error: "Subscriber not found" });
    if (!sub.active) return res.status(403).json({ error: "Your subscription is inactive" });
    const trimmed = body.trim().slice(0, 2000);
    await db.prepare(
      "INSERT INTO comments (news_id, subscriber_name, subscriber_email, body) VALUES (?, ?, ?, ?)"
    ).run(news_id, sub.name, email.trim().toLowerCase(), trimmed);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/comments/:id", async (req, res) => {
  await ready();
  try {
    const commentId = Number(req.params.id);
    let authorized = false;
    let isAdminUser = false;

    /* 1) Basic auth (admin panel) */
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Basic ")) {
      let user, pass;
      try {
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        user = decoded.slice(0, idx);
        pass = decoded.slice(idx + 1);
      } catch {}
      if (user) {
        const row = await checkCreds(user, pass);
        if (row) { authorized = true; isAdminUser = true; }
      }
    }

    /* 2) X-Admin-Email (admin via subscriber profile) */
    const adminEmail = req.headers["x-admin-email"];
    if (!authorized && adminEmail) {
      const sub = await db.prepare(
        "SELECT id FROM subscribers WHERE LOWER(email) = ? AND source = 'admin'"
      ).get(adminEmail.toLowerCase().trim());
      if (sub) { authorized = true; isAdminUser = true; }
    }

    /* 3) X-Comment-Email (subscriber deleting own comment) */
    const commentEmail = req.headers["x-comment-email"];
    if (!authorized && commentEmail) {
      /* verify subscriber exists and is active */
      const sub = await db.prepare(
        "SELECT id, active FROM subscribers WHERE LOWER(email) = ?"
      ).get(commentEmail.toLowerCase().trim());
      if (sub && sub.active) {
        /* check if this subscriber owns the comment */
        const comment = await db.prepare(
          "SELECT id FROM comments WHERE id = ? AND LOWER(subscriber_email) = ?"
        ).get(commentId, commentEmail.toLowerCase().trim());
        if (comment) authorized = true;
      }
    }

    if (!authorized) return res.status(401).json({ error: "Unauthorized" });
    const r = await db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
    if (r.changes === 0) return res.status(404).json({ error: "Comment not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Notifications (admin → subscribers email campaigns) ===== */
app.get("/api/notifications", requireAuth, async (req, res) => {
  await ready();
  try {
    const rows = await db.prepare("SELECT * FROM notifications ORDER BY created_at DESC").all();
    res.json({ notifications: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications", requireAuth, async (req, res) => {
  await ready();
  try {
    const { title, message, category, scheduled_at } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });
    const cat = category || "";
    const sched = scheduled_at || null;
    const r = await db.prepare(
      "INSERT INTO notifications (title, message, category, scheduled_at) VALUES (?, ?, ?, ?)"
    ).run(title.trim(), message.trim(), cat, sched);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notifications/:id", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    const r = await db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications/:id/send", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    const notif = await db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
    if (!notif) return res.status(404).json({ error: "Not found" });
    if (notif.sent) return res.status(400).json({ error: "Already sent" });

    /* count active subscribers — optionally filter by notification category */
    let count;
    if (notif.category && notif.category !== "সব") {
      count = await db.prepare(
        "SELECT COUNT(*) AS c FROM subscribers WHERE active = 1 AND email IS NOT NULL AND email != ''"
      ).get();
    } else {
      count = await db.prepare(
        "SELECT COUNT(*) AS c FROM subscribers WHERE active = 1 AND email IS NOT NULL AND email != ''"
      ).get();
    }
    const total = count?.c || 0;

    await db.prepare(
      "UPDATE notifications SET sent = 1, sent_at = CURRENT_TIMESTAMP, recipient_count = ? WHERE id = ?"
    ).run(total, id);

    res.json({ ok: true, recipientCount: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Admin API ===== */
app.get("/api/admin/check", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.admin?.username || ADMIN_USER,
    display_name: req.admin?.display_name || "Editor",
    role: req.admin?.role || "admin"
  });
});

/* ===== Admin profile — get / update ===== */
app.get("/api/admin/profile", requireAuth, async (req, res) => {
  await ready();
  if (req.admin?._env) {
    /* env-var admin (no DB row) */
    return res.json({
      id: 0,
      username: ADMIN_USER,
      display_name: "Editor",
      role: "admin",
      avatar: null,
      created_at: null,
      last_login: null,
      source: "env"
    });
  }
  const row = await db.prepare(
    "SELECT id, username, display_name, role, email, phone, avatar, created_at, last_login, updated_at FROM admins WHERE id = ?"
  ).get(req.admin.id);
  if (!row) return res.status(404).json({ error: "Admin not found" });
  res.json({ ...row, source: "db" });
});

app.put("/api/admin/profile", requireAuth, async (req, res) => {
  await ready();
  const { username, display_name, email, phone, avatar, current_password, new_password } = req.body || {};

  /* if env-managed, promote to a real DB row on first edit (so we can persist changes) */
  if (req.admin?._env) {
    const seedUser = String(username || req.admin.username).trim();
    const seedHash = await bcrypt.hash(ADMIN_PASS || "1234", 10);
    await db.prepare(
      "INSERT OR IGNORE INTO admins (username, password, display_name, role, email, phone) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(seedUser, seedHash, "Editor", "admin", null, null);
    const created = await db.prepare("SELECT id FROM admins WHERE username = ?").get(seedUser);
    if (created) req.admin = { ...req.admin, id: created.id, _env: false };
  }

  /* get current row */
  const cur = await db.prepare(
    "SELECT id, username, password, display_name, email, phone, avatar FROM admins WHERE id = ?"
  ).get(req.admin.id);
  if (!cur) return res.status(404).json({ error: "Admin not found" });

  /* password change requires current password (unless new password is empty) */
  if (new_password) {
    if (!current_password) {
      return res.status(400).json({ error: "বর্তমান পাসওয়ার্ড দিতে হবে" });
    }
    const ok = await bcrypt.compare(current_password, cur.password);
    if (!ok) return res.status(401).json({ error: "বর্তমান পাসওয়ার্ড ভুল" });
    if (new_password.length < 4) {
      return res.status(400).json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে" });
    }
  }

  /* username change — must be unique */
  let newUsername = cur.username;
  if (username && username !== cur.username) {
    const trimmed = String(username).trim();
    if (trimmed.length < 2) return res.status(400).json({ error: "Username too short" });
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      return res.status(400).json({ error: "Username শুধু letter, number, _, ., - হতে পারে" });
    }
    const exists = await db.prepare("SELECT id FROM admins WHERE username = ? AND id != ?").get(trimmed, cur.id);
    if (exists) return res.status(409).json({ error: "Username already taken" });
    newUsername = trimmed;
  }

  let newHash = cur.password;
  if (new_password) {
    newHash = await bcrypt.hash(new_password, 10);
  }

  let newDisplay = cur.display_name;
  if (display_name !== undefined) {
    newDisplay = String(display_name).trim().slice(0, 60) || "Editor";
  }

  /* email validation (optional, but if given must be valid) */
  let newEmail = cur.email;
  if (email !== undefined) {
    const trimmed = String(email).trim().toLowerCase().slice(0, 120);
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      return res.status(400).json({ error: "Email ঠিকমতো দিন (e.g. you@example.com)" });
    }
    newEmail = trimmed || null;
  }

  /* phone validation (BD-friendly: 01XXXXXXXXX or +8801XXXXXXXXX, 10–15 digits) */
  let newPhone = cur.phone;
  if (phone !== undefined) {
    const trimmed = String(phone).trim().slice(0, 20);
    if (trimmed) {
      const digits = trimmed.replace(/[^\d]/g, "");
      if (digits.length < 10 || digits.length > 15) {
        return res.status(400).json({ error: "Phone সংখ্যা ১০–১৫ digit হতে হবে" });
      }
      newPhone = trimmed;
    } else {
      newPhone = null;
    }
  }

  /* avatar — if provided, store data URL or external URL (max 500KB) */
  let newAvatar = cur.avatar;
  if (avatar !== undefined) {
    const trimmed = String(avatar).trim();
    if (trimmed) {
      if (trimmed.length > 500000) {
        return res.status(400).json({ error: "Avatar image太大了 (max 500KB)" });
      }
      newAvatar = trimmed;
    } else {
      newAvatar = null;
    }
  }

  await db.prepare(
    "UPDATE admins SET username = ?, password = ?, display_name = ?, email = ?, phone = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(newUsername, newHash, newDisplay, newEmail, newPhone, newAvatar, cur.id);

  res.json({
    ok: true,
    username: newUsername,
    display_name: newDisplay,
    email: newEmail,
    phone: newPhone,
    avatar: newAvatar
  });
});

/* ===== Admin → subscriber sync (auto-create subscriber profile for admin) ===== */
app.post("/api/admin/sync-subscriber", requireAuth, async (req, res) => {
  await ready();
  try {
    /* get admin info */
    let adminEmail = "";
    let adminName = "Admin";
    if (req.admin?._env) {
      adminEmail = ADMIN_USER + "@admin.prothom-songbad.com";
      adminName = ADMIN_USER;
    } else {
      const row = await db.prepare(
        "SELECT email, display_name, username FROM admins WHERE id = ?"
      ).get(req.admin.id);
      if (row) {
        adminEmail = row.email || row.username + "@admin.prothom-songbad.com";
        adminName = row.display_name || row.username;
      } else {
        adminEmail = "admin@admin.prothom-songbad.com";
      }
    }
    const email = adminEmail.toLowerCase().trim();
    /* upsert subscriber record */
    const existing = await db.prepare("SELECT id FROM subscribers WHERE LOWER(email) = ?").get(email);
    if (existing) {
      await db.prepare("UPDATE subscribers SET name = ?, active = 1 WHERE id = ?").run(adminName, existing.id);
    } else {
      const hash = await bcrypt.hash("admin1234", 10);
      await db.prepare(
        "INSERT INTO subscribers (name, phone, email, password, source, active) VALUES (?, ?, ?, ?, 'admin', 1)"
      ).run(adminName, "", email, hash);
    }
    const sub = await db.prepare(
      "SELECT id, name, phone, email, active, created_at, address, avatar FROM subscribers WHERE LOWER(email) = ?"
    ).get(email);
    res.json({ subscriber: { ...sub, is_admin: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Analytics ===== */
function rangeSince(range){
  if (range === "24h") return "datetime('now','-1 day')";
  if (range === "7d")  return "datetime('now','-7 days')";
  if (range === "30d") return "datetime('now','-30 days')";
  return "datetime('now','-100 years')";
}

/* Public: record a page view (fire-and-forget from client) */
app.post("/api/track-view", async (req, res) => {
  try {
    const newsId = req.body && req.body.newsId ? Number(req.body.newsId) : null;
    const path   = (req.body && req.body.path) || (req.headers.referer || "").toString().slice(0, 240) || "/";
    const ref    = (req.headers.referer || "").toString().slice(0, 240) || null;
    const ua     = (req.headers["user-agent"] || "").toString().slice(0, 240) || null;
    const ip     = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim().slice(0, 45) || null;
    const country = (req.headers["cf-ipcountry"] || "").toString().toUpperCase().slice(0, 4) || null;
    const r = await db.prepare(
      "INSERT INTO page_views (news_id, path, ref, ua, ip, country) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(newsId, path, ref, ua, ip, country);
    /* if no CF header, try ip-api.com in background */
    if (!country && ip && ip !== "::1" && ip !== "127.0.0.1" && !ip.startsWith("192.168.") && !ip.startsWith("10.")) {
      const lastId = r.lastInsertRowid;
      fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=countryCode`).then(r2 => r2.json()).then(d => {
        if (d && d.countryCode) {
          db.prepare("UPDATE page_views SET country = ? WHERE id = ?").run(d.countryCode, lastId).catch(() => {});
        }
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Auth: dashboard analytics */
app.get("/api/analytics", requireAuth, async (req, res) => {
  try {
    const range = (req.query.range || "7d").toString();
    const since = rangeSince(range);

    /* overall counts */
    const totals = {
      posts:        (await db.prepare("SELECT COUNT(*) AS c FROM news").get()).c || 0,
      postsInRange: (await db.prepare("SELECT COUNT(*) AS c FROM news WHERE created_at >= " + since).get()).c || 0,
      categories:   (await db.prepare("SELECT COUNT(*) AS c FROM categories").get()).c || 0,
      subcategories:(await db.prepare("SELECT COUNT(*) AS c FROM subcategories").get()).c || 0,
      videos:       (await db.prepare("SELECT COUNT(*) AS c FROM news WHERE video IS NOT NULL AND video != ''").get()).c || 0,
      views:        (await db.prepare("SELECT COUNT(*) AS c FROM page_views WHERE created_at >= " + since).get()).c || 0,
      viewsAll:     (await db.prepare("SELECT COUNT(*) AS c FROM page_views").get()).c || 0,
      uniqueVisitors: (await db.prepare("SELECT COUNT(DISTINCT ua) AS c FROM page_views WHERE created_at >= " + since).get()).c || 0
    };

    /* views over time (daily buckets) */
    const bucketExpr = range === "24h"
      ? "strftime('%H:00', created_at)"
      : "strftime('%m-%d', created_at)";
    const viewsByDay = await db.prepare(`
      SELECT ${bucketExpr} AS bucket, COUNT(*) AS c
      FROM page_views
      WHERE created_at >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all();

    /* posts by category (with view counts) */
    const byCategory = await db.prepare(`
      SELECT c.name AS category,
             (SELECT COUNT(*) FROM news n WHERE n.category = c.name) AS posts,
             (SELECT COUNT(*) FROM page_views pv WHERE pv.news_id IN (SELECT id FROM news WHERE category = c.name) AND pv.created_at >= ${since}) AS views
      FROM categories c
      ORDER BY posts DESC, c.name ASC
    `).all();

    /* top news by views */
    const topNews = await db.prepare(`
      SELECT n.id, n.title, n.category, n.subcategory, COUNT(pv.id) AS views
      FROM news n
      LEFT JOIN page_views pv ON pv.news_id = n.id AND pv.created_at >= ${since}
      GROUP BY n.id
      HAVING views > 0
      ORDER BY views DESC, n.id DESC
      LIMIT 10
    `).all();

    /* recent activity */
    const recent = await db.prepare(`
      SELECT n.id, n.title, n.category, n.created_at
      FROM news n
      WHERE n.created_at >= ${since}
      ORDER BY n.id DESC
      LIMIT 8
    `).all();

    /* posts per day in range */
    const postsByDay = await db.prepare(`
      SELECT strftime('%m-%d', created_at) AS bucket, COUNT(*) AS c
      FROM news
      WHERE created_at >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all();

    res.json({ range, totals, viewsByDay, byCategory, topNews, recent, postsByDay });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Traffic sources (referrer analysis) */
app.get("/api/analytics/referrers", requireAuth, async (req, res) => {
  try {
    const range = (req.query.range || "7d").toString();
    const since = rangeSince(range);
    const rows = await db.prepare(`
      SELECT ref, COUNT(*) AS c
      FROM page_views
      WHERE created_at >= ${since}
      GROUP BY ref
      ORDER BY c DESC
    `).all();
    const total = rows.reduce((s, r) => s + r.c, 0) || 1;
    const sources = { "Google": 0, "Facebook": 0, "Twitter / X": 0, "Instagram": 0, "YouTube": 0, "Other Social": 0, "Direct": 0, "Other": 0 };
    const sourceColors = { "Google":"#4285F4", "Facebook":"#1877F2", "Twitter / X":"#000", "Instagram":"#E4405F", "YouTube":"#FF0000", "Other Social":"#9C27B0", "Direct":"#4CAF50", "Other":"#9E9E9E" };
    for (const r of rows) {
      const ref = (r.ref || "").toLowerCase();
      if (!ref) { sources["Direct"] += r.c; continue; }
      if (ref.includes("google"))  { sources["Google"] += r.c; continue; }
      if (ref.includes("facebook")){ sources["Facebook"] += r.c; continue; }
      if (ref.includes("twitter") || ref.includes("x.com")){ sources["Twitter / X"] += r.c; continue; }
      if (ref.includes("instagram")){ sources["Instagram"] += r.c; continue; }
      if (ref.includes("youtube")){ sources["YouTube"] += r.c; continue; }
      if (ref.includes("t.co") || ref.includes("linkedin") || ref.includes("pinterest") || ref.includes("reddit") || ref.includes("t.me") || ref.includes("whatsapp")){ sources["Other Social"] += r.c; continue; }
      sources["Other"] += r.c;
    }
    const breakdown = Object.entries(sources).map(([label, count]) => ({
      label, count, pct: Math.round((count / total) * 100), color: sourceColors[label]
    })).filter(s => s.count > 0);
    res.json({ range, total, breakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Top referrers (detailed list) */
app.get("/api/analytics/top-referrers", requireAuth, async (req, res) => {
  try {
    const range = (req.query.range || "7d").toString();
    const since = rangeSince(range);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const rows = await db.prepare(`
      SELECT ref, COUNT(*) AS c
      FROM page_views
      WHERE created_at >= ${since} AND ref IS NOT NULL AND ref != ''
      GROUP BY ref
      ORDER BY c DESC
      LIMIT ?
    `).all(limit);
    const total = rows.reduce((s, r) => s + r.c, 0) || 1;
    res.json({ range, total, list: rows.map(r => ({ ref: r.ref, count: r.c, pct: Math.round((r.c / total) * 100) })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Visitor countries */
app.get("/api/analytics/countries", requireAuth, async (req, res) => {
  try {
    const range = (req.query.range || "7d").toString();
    const since = rangeSince(range);
    const rows = await db.prepare(`
      SELECT country, COUNT(*) AS c
      FROM page_views
      WHERE created_at >= ${since} AND country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY c DESC
    `).all();
    const total = rows.reduce((s, r) => s + r.c, 0) || 1;
    const countryNames = {
      BD:"Bangladesh", IN:"India", US:"United States", GB:"United Kingdom", CA:"Canada",
      AU:"Australia", SA:"Saudi Arabia", AE:"UAE", MY:"Malaysia", SG:"Singapore",
      PK:"Pakistan", NP:"Nepal", LK:"Sri Lanka", CN:"China", JP:"Japan",
      DE:"Germany", FR:"France", IT:"Italy", NL:"Netherlands", SE:"Sweden",
      NO:"Norway", DK:"Denmark", FI:"Finland", ES:"Spain", PT:"Portugal",
      BR:"Brazil", ZA:"South Africa", NG:"Nigeria", KE:"Kenya", EG:"Egypt",
      RU:"Russia", TR:"Turkey", IR:"Iran", QA:"Qatar", KW:"Kuwait",
      OM:"Oman", BH:"Bahrain", ID:"Indonesia", PH:"Philippines", TH:"Thailand",
      KR:"South Korea", TW:"Taiwan", HK:"Hong Kong", NZ:"New Zealand"
    };
    const list = rows.map(r => ({
      country: r.country, name: countryNames[r.country] || r.country, count: r.c, pct: Math.round((r.c / total) * 100)
    }));
    res.json({ range, total, list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/news", requireAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "videoFile", maxCount: 1 }]), async (req, res) => {
  try {
    const { title, category, subcategory, details, imageUrl, video } = req.body;
    if (!title || !category || !details) {
      return res.status(400).json({ error: "title, category, details are required" });
    }
    const catExists = await db.prepare("SELECT 1 FROM categories WHERE name = ?").get(category);
    if (!catExists) {
      return res.status(400).json({ error: `"${category}" ক্যাটাগরি নেই — আগে ক্যাটাগরি তৈরি করুন` });
    }
    let image = null;
    const imgFile = req.files?.image?.[0];
    if (imgFile) {
      image = fileToDataUrl(imgFile);
    } else if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      image = imageUrl;
    }
    let v = (typeof video === "string" && video.trim()) ? video.trim() : null;
    const vidFile = req.files?.videoFile?.[0];
    if (vidFile) {
      v = fileToDataUrl(vidFile);
    }
    const sub = (typeof subcategory === "string" && subcategory.trim()) ? subcategory.trim() : null;
    const time = new Date().toLocaleString();
    const r = await db.prepare(
      "INSERT INTO news (title, category, subcategory, details, image, video, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(title, category, sub, details, image, v, time);
    const newsId = r.lastInsertRowid;
    /* handle article images */
    const articleImages = parseArticleImages(req.body.articleImages);
    for (const img of articleImages) {
      await db.prepare(
        "INSERT INTO news_images (news_id, image_url, caption, sort_order) VALUES (?, ?, ?, ?)"
      ).run(newsId, img.image_url, img.caption, img.sort_order);
    }
    const row = await db.prepare("SELECT * FROM news WHERE id = ?").get(newsId);
    row.article_images = articleImages;
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/news/:id", requireAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "videoFile", maxCount: 1 }]), async (req, res) => {
  try {
    const existing = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "News not found" });
    if (req.body.category && req.body.category !== existing.category) {
      const catExists = await db.prepare("SELECT 1 FROM categories WHERE name = ?").get(req.body.category);
      if (!catExists) {
        return res.status(400).json({ error: `“${req.body.category}” ক্যাটাগরি নেই — আগে ক্যাটাগরি তৈরি করুন` });
      }
    }

    const { title, category, subcategory, details, imageUrl, video, keepImage } = req.body;
    let image;
    const imgFile = req.files?.image?.[0];
    if (imgFile) {
      image = fileToDataUrl(imgFile);
    } else if (typeof imageUrl === "string" && /^https?:\/\//.test(imageUrl)) {
      image = imageUrl;
    } else if (keepImage === "1" && existing.image) {
      image = existing.image;
    } else {
      image = null;
    }
    let videoVal;
    const vidFile = req.files?.videoFile?.[0];
    if (vidFile) {
      videoVal = fileToDataUrl(vidFile);
    } else if (typeof video === "string") {
      videoVal = video.trim() ? video.trim() : null;
    } else {
      videoVal = existing.video;
    }
    let subVal;
    if (typeof subcategory === "string") {
      subVal = subcategory.trim() ? subcategory.trim() : null;
    } else {
      subVal = existing.subcategory;
    }

    await db.prepare(
      "UPDATE news SET title = ?, category = ?, subcategory = ?, details = ?, image = ?, video = ?, time = ? WHERE id = ?"
    ).run(
      title    ?? existing.title,
      category ?? existing.category,
      subVal,
      details  ?? existing.details,
      image,
      videoVal,
      new Date().toLocaleString(),
      req.params.id
    );
    const row = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    /* handle article images */
    await db.prepare("DELETE FROM news_images WHERE news_id = ?").run(req.params.id);
    const articleImages = parseArticleImages(req.body.articleImages);
    for (const img of articleImages) {
      await db.prepare(
        "INSERT INTO news_images (news_id, image_url, caption, sort_order) VALUES (?, ?, ?, ?)"
      ).run(req.params.id, img.image_url, img.caption, img.sort_order);
    }
    row.article_images = articleImages;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/news/:id", requireAuth, async (req, res) => {
  try {
    const existing = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "News not found" });
    await db.prepare("DELETE FROM news_images WHERE news_id = ?").run(req.params.id);
    await db.prepare("DELETE FROM news WHERE id = ?").run(req.params.id);
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/news/batch-delete", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const placeholders = ids.map(() => "?").join(",");
    await db.prepare(`DELETE FROM news_images WHERE news_id IN (${placeholders})`).run(...ids);
    const result = await db.prepare(`DELETE FROM news WHERE id IN (${placeholders})`).run(...ids);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/* ============================================================
   Inbox — incoming email (Cloudflare Email Routing webhook)
   ============================================================ */

/* Webhook: receives email from Cloudflare Email Worker.
   Worker code (provided separately in admin panel) should POST
   JSON with: { from, to, subject, body_text, body_html, message_id, headers }
   Authenticated by shared secret in header. */
app.post("/api/inbox/webhook", async (req, res) => {
  await ready();
  try {
    const secret = process.env.INBOX_WEBHOOK_SECRET || "";
    if(secret){
      const got = req.headers["x-webhook-secret"] || req.headers["x-inbox-secret"] || "";
      if(got !== secret) return res.status(401).json({ error: "Invalid webhook secret" });
    }
    const { from, to, subject, body_text, body_html, message_id, in_reply_to, headers, source } = req.body || {};
    if(!from && !subject && !body_text && !body_html){
      return res.status(400).json({ error: "Empty payload" });
    }
    /* parse from "Name <a@b.com>" format */
    let fromEmail = "", fromName = "";
    const fm = String(from || "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
    if(fm){ fromName = fm[1].trim(); fromEmail = fm[2].trim().toLowerCase(); }
    else  { fromEmail = String(from || "").trim().toLowerCase(); }
    const toEmail = String(to || "").trim().toLowerCase();
    /* dedup by message_id */
    if(message_id){
      const dup = await db.prepare("SELECT id FROM inbox_messages WHERE message_id = ?").get(message_id);
      if(dup) return res.json({ ok: true, id: dup.id, dedup: true });
    }
    const subj = String(subject || "(no subject)").slice(0, 500);
    const txt  = body_text ? String(body_text).slice(0, 50000) : null;
    const html = body_html ? String(body_html).slice(0, 200000) : null;
    const snippet = (txt || (html ? html.replace(/<[^>]+>/g, " ") : "")).replace(/\s+/g, " ").trim().slice(0, 220);
    const result = await db.prepare(
      "INSERT INTO inbox_messages (direction, from_email, from_name, to_email, subject, snippet, body_text, body_html, message_id, in_reply_to, headers_json, source) VALUES ('inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      fromEmail, fromName, toEmail, subj, snippet, txt, html,
      message_id || null, in_reply_to || null,
      headers ? JSON.stringify(headers).slice(0, 50000) : null,
      (source || "cloudflare").slice(0, 30)
    );
    res.json({ ok: true, id: result.lastInsertRowid || result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Test: insert a fake message (for demo / verifying the UI without email service) */
app.post("/api/inbox/test", requireAuth, async (req, res) => {
  await ready();
  try {
    const samples = [
      { from: "Rahim Khan <rahim@example.com>",        subject: "আপনার সাইটে বিজ্ঞাপন দিতে চাই",            text: "স্যার, আমি আমার দোকানের বিজ্ঞাপন prothom-songbad.com এ দিতে চাই। মাসিক খরচ কত হবে?\n\nধন্যবাদ,\nRahim" },
      { from: "newsletter@prothomsports.com",          subject: "Weekly digest — top 10 sports stories",   text: "This week in sports: cricket world cup qualifiers, FIFA friendly matches, and more. Click to read all 10 stories." },
      { from: "noreply@github.com",                    subject: "[GitHub] New login to your account",      text: "A new sign-in was detected from Chrome on Windows. If this wasn't you, please secure your account." },
      { from: "Sadia Hossain <sadia.h@gmail.com>",     subject: "একটি অনুসন্ধান",                            text: "আসসালামু আলাইকুম, আমি একজন পাঠক। আপনাদের জাতীয় বিভাগে গতকাল একটি সংবাদ ছিল যেটি এখন দেখতে পাচ্ছি না। লিংক দিতে পারবেন?" },
      { from: "support@cloudflare.com",                subject: "Your Cloudflare Email Routing is active", text: "Your email routing is now active. Incoming emails to admin@prothom-songbad.com will be delivered to your destination." }
    ];
    const s = samples[Math.floor(Math.random() * samples.length)];
    const fm = s.from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
    const fromName = fm ? fm[1].trim() : "";
    const fromEmail = fm ? fm[2].trim().toLowerCase() : s.from.toLowerCase();
    const to = req.body?.to || "admin@prothom-songbad.com";
    const result = await db.prepare(
      "INSERT INTO inbox_messages (direction, from_email, from_name, to_email, subject, snippet, body_text, source) VALUES ('inbound', ?, ?, ?, ?, ?, ?, 'test')"
    ).run(fromEmail, fromName, to.toLowerCase(), s.subject, s.text.slice(0, 220), s.text);
    res.json({ ok: true, id: result.lastInsertRowid || result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* List messages */
app.get("/api/inbox", requireAuth, async (req, res) => {
  await ready();
  try {
    const filter = String(req.query.filter || "all"); // all | unread | starred | archived | spam
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    let where = "1=1";
    const args = [];
    if(filter === "unread")   where += " AND read=0 AND archived=0 AND spam=0";
    else if(filter === "starred")  where += " AND starred=1";
    else if(filter === "archived") where += " AND archived=1";
    else if(filter === "spam")     where += " AND spam=1";
    else                            where += " AND archived=0 AND spam=0";
    if(q){
      where += " AND (subject LIKE ? OR from_email LIKE ? OR from_name LIKE ? OR body_text LIKE ?)";
      const like = "%" + q + "%";
      args.push(like, like, like, like);
    }
    const rows = await db.prepare(
      `SELECT id, direction, from_email, from_name, to_email, subject, snippet, read, starred, archived, spam, source, created_at
       FROM inbox_messages WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...args, limit, offset);
    const counts = await db.prepare(
      `SELECT
         SUM(CASE WHEN read=0 AND archived=0 AND spam=0 THEN 1 ELSE 0 END) AS unread,
         SUM(CASE WHEN starred=1 THEN 1 ELSE 0 END) AS starred,
         SUM(CASE WHEN archived=1 THEN 1 ELSE 0 END) AS archived,
         SUM(CASE WHEN spam=1 THEN 1 ELSE 0 END) AS spam,
         COUNT(*) AS total
       FROM inbox_messages`
    ).get();
    res.json({ messages: rows, counts, filter, q });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Get one message (and mark as read) */
app.get("/api/inbox/:id", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ error: "Invalid id" });
    const row = await db.prepare("SELECT * FROM inbox_messages WHERE id = ?").get(id);
    if(!row) return res.status(404).json({ error: "Message not found" });
    if(!row.read){
      await db.prepare("UPDATE inbox_messages SET read=1 WHERE id=?").run(id);
      row.read = 1;
    }
    /* parse headers_json for display */
    let headers = null;
    if(row.headers_json){ try { headers = JSON.parse(row.headers_json); } catch {} }
    res.json({ ...row, headers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Toggle read / starred / archived / spam */
app.put("/api/inbox/:id/:action", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    const action = String(req.params.action);
    if(!id) return res.status(400).json({ error: "Invalid id" });
    const col = action === "read"     ? "read"
              : action === "star"     ? "starred"
              : action === "unstar"   ? "starred"
              : action === "archive"  ? "archived"
              : action === "unarchive"? "archived"
              : action === "spam"     ? "spam"
              : action === "unspam"   ? "spam"
              : null;
    if(!col) return res.status(400).json({ error: "Invalid action" });
    const val = (action.startsWith("un")) ? 0 : 1;
    await db.prepare(`UPDATE inbox_messages SET ${col}=? WHERE id=?`).run(val, id);
    res.json({ ok: true, id, [col]: val });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Delete message */
app.delete("/api/inbox/:id", requireAuth, async (req, res) => {
  await ready();
  try {
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ error: "Invalid id" });
    await db.prepare("DELETE FROM inbox_messages WHERE id=?").run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Cloudflare Email Worker — code for admin to copy */
app.get("/api/inbox/worker-code", requireAuth, async (req, res) => {
  await ready();
  const webhookUrl = `${req.protocol}://${req.get("host")}/api/inbox/webhook`;
  const secret = process.env.INBOX_WEBHOOK_SECRET || "INBOX_SECRET_HERE";
  const code = `// Cloudflare Email Worker — paste this in Workers → your-email-routing-worker → "Email Workers"
// 1. Cloudflare Dashboard → Email → Email Routing → enable
// 2. Click "Edit" on the destination/worker, paste this code
// 3. Set environment variables: WEBHOOK_URL and WEBHOOK_SECRET (match Vercel env)
// 4. Add a routing rule: Catch-all address → admin@prothom-songbad.com → this worker

export default {
  async email(message, env, ctx) {
    try {
      const headers = {};
      for (const [k, v] of message.headers) headers[k.toLowerCase()] = v;

      const from = message.from;
      const to = message.to;
      const subject = headers["subject"] || "(no subject)";
      const messageId = headers["message-id"] || "";

      // Read raw email body (MIME)
      const reader = message.raw.getReader();
      const decoder = new TextDecoder("utf-8");
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }

      // Extract a simple text body from MIME (best-effort).
      // For full HTML body, you can use a MIME parser library.
      let bodyText = raw;
      let bodyHtml = null;
      const ct = (headers["content-type"] || "").toLowerCase();
      if (ct.includes("multipart/")) {
        // crude split: find first text/plain part
        const m = raw.match(/Content-Type:\\s*text\\/plain[^\\n]*\\r?\\n\\r?\\n([\\s\\S]*?)(?:\\r?\\n--[A-Za-z0-9_=-]+)/i);
        if (m) bodyText = m[1].trim();
        const h = raw.match(/Content-Type:\\s*text\\/html[^\\n]*\\r?\\n\\r?\\n([\\s\\S]*?)(?:\\r?\\n--[A-Za-z0-9_=-]+)/i);
        if (h) bodyHtml = h[1].trim();
      }

      await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": env.WEBHOOK_SECRET
        },
        body: JSON.stringify({
          from, to, subject,
          body_text: bodyText,
          body_html: bodyHtml,
          message_id: messageId,
          headers: { from, to, subject, "message-id": messageId, date: headers["date"] || "" },
          source: "cloudflare"
        })
      });
    } catch (err) {
      console.error("email worker error:", err);
    }
  }
};
`;
  res.json({ code, webhookUrl, secretEnv: "INBOX_WEBHOOK_SECRET" });
});

/* ===== Admin Users CRUD ===== */
app.get("/api/admins", requireAuth, async (req, res) => {
  await ready();
  const rows = await db.prepare(
    "SELECT id, username, display_name, role, email, phone, created_at, last_login FROM admins ORDER BY role, username"
  ).all();
  res.json(rows);
});

app.post("/api/admins", requireAuth, async (req, res) => {
  await ready();
  const { username, password, display_name, role, email, phone } = req.body || {};
  const u = String(username || "").trim();
  const p = String(password || "");
  const d = String(display_name || u).trim().slice(0, 60) || "Editor";
  const r = role === "superadmin" ? "superadmin" : "admin";
  if (!u || u.length < 2) return res.status(400).json({ error: "Username কমপক্ষে ২ অক্ষরের হতে হবে" });
  if (!/^[a-zA-Z0-9_.-]+$/.test(u))
    return res.status(400).json({ error: "Username শুধু letter, number, _, ., - হতে পারে" });
  if (p.length < 4) return res.status(400).json({ error: "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে" });
  const exists = await db.prepare("SELECT id FROM admins WHERE username = ?").get(u);
  if (exists) return res.status(409).json({ error: "Username already taken" });
  const hash = await bcrypt.hash(p, 10);
  let e = String(email || "").trim().toLowerCase().slice(0, 120) || null;
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) e = null;
  let ph = String(phone || "").trim().slice(0, 20) || null;
  const result = await db.prepare(
    "INSERT INTO admins (username, password, display_name, role, email, phone) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(u, hash, d, r, e, ph);
  res.json({ ok: true, id: result.lastInsertRowid, username: u, display_name: d, role: r });
});

app.put("/api/admins/:id", requireAuth, async (req, res) => {
  await ready();
  const id = Number(req.params.id);
  const cur = await db.prepare("SELECT id, username, password FROM admins WHERE id = ?").get(id);
  if (!cur) return res.status(404).json({ error: "Admin not found" });
  if (cur.id === req.admin?.id && req.body?.role && req.body.role !== (req.admin.role || "admin"))
    return res.status(400).json({ error: "You cannot change your own role" });
  const { username, password, display_name, role, email, phone } = req.body || {};
  let u = String(username || cur.username).trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(u))
    return res.status(400).json({ error: "Username শুধু letter, number, _, ., - হতে পারে" });
  const dup = await db.prepare("SELECT id FROM admins WHERE username = ? AND id != ?").get(u, id);
  if (dup) return res.status(409).json({ error: "Username already taken" });
  let newHash = cur.password;
  if (password) {
    if (String(password).length < 4) return res.status(400).json({ error: "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে" });
    newHash = await bcrypt.hash(password, 10);
  }
  const d = String(display_name || "").trim().slice(0, 60) || "Editor";
  const r = role === "superadmin" ? "superadmin" : role === "admin" ? "admin" : undefined;
  let e = email !== undefined ? (String(email).trim().toLowerCase().slice(0, 120) || null) : undefined;
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
    return res.status(400).json({ error: "Email ঠিকমতো দিন" });
  let ph = phone !== undefined ? (String(phone).trim().slice(0, 20) || null) : undefined;
  await db.prepare(
    "UPDATE admins SET username = ?, password = ?, display_name = ?, role = COALESCE(?, role), email = COALESCE(?, email), phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(u, newHash, d, r || null, e ?? null, ph ?? null, id);
  res.json({ ok: true, id, username: u });
});

app.delete("/api/admins/:id", requireAuth, async (req, res) => {
  await ready();
  const id = Number(req.params.id);
  if (id === req.admin?.id) return res.status(400).json({ error: "You cannot delete yourself" });
  const cur = await db.prepare("SELECT id FROM admins WHERE id = ?").get(id);
  if (!cur) return res.status(404).json({ error: "Admin not found" });
  await db.prepare("DELETE FROM admins WHERE id = ?").run(id);
  res.json({ ok: true });
});

/* ===== Serverless handler ===== */
export default async function handler(req, res) {
  await ready();
  return app(req, res);
}
