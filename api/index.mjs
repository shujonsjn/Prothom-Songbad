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
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    )
  `);
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
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_banners_pos ON banners(position, active, sort_order)"); } catch {}

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
      await db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(r.category);
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});
function fileToDataUrl(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

/* ===== Public API ===== */
app.get("/api/news", async (req, res) => {
  try {
    const category = (req.query.category || "").toString().trim();
    const subcategory = (req.query.sub || req.query.subcategory || "").toString().trim();
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
    const sql = where.length
      ? `SELECT * FROM news WHERE ${where.join(" AND ")} ORDER BY id DESC`
      : "SELECT * FROM news ORDER BY id DESC";
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
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT c.name AS category, COUNT(n.id) AS count
      FROM categories c
      LEFT JOIN news n ON n.category = c.name
      GROUP BY c.name
      ORDER BY count DESC, c.name ASC
    `).all();
    res.json(rows);
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
    await db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
    res.status(201).json({ ok: true, name });
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
    const r = await db.prepare("DELETE FROM categories WHERE name = ?").run(name);
    if (r.changes === 0) return res.status(404).json({ error: "Category not found" });
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Banners / Ads ===== */
const ALLOWED_BANNER_POS = ["sidebar-bottom", "sidebar-top", "header", "footer", "inline"];
app.get("/api/banners", async (req, res) => {
  await ready();
  try {
    const pos = (req.query.position || "").trim();
    const sql = pos
      ? "SELECT id, position, title, image_url, link_url, active, sort_order, created_at FROM banners WHERE position = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
      : "SELECT id, position, title, image_url, link_url, active, sort_order, created_at FROM banners ORDER BY position ASC, sort_order ASC, id ASC";
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
    const { position, title, image_url, link_url, active, sort_order } = req.body || {};
    if (!position || !ALLOWED_BANNER_POS.includes(position)) {
      return res.status(400).json({ error: "Invalid position" });
    }
    if (!image_url || !String(image_url).trim()) {
      return res.status(400).json({ error: "Image URL দিতে হবে" });
    }
    const r = await db.prepare(
      "INSERT INTO banners (position, title, image_url, link_url, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      position,
      (title || "").trim().slice(0, 200) || null,
      String(image_url).trim(),
      (link_url || "").trim().slice(0, 500) || null,
      active === false || active === 0 ? 0 : 1,
      Number(sort_order) || 0
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
    const { position, title, image_url, link_url, active, sort_order } = req.body || {};
    const pos = (position || cur.position);
    if (!ALLOWED_BANNER_POS.includes(pos)) return res.status(400).json({ error: "Invalid position" });
    await db.prepare(
      "UPDATE banners SET position=?, title=?, image_url=?, link_url=?, active=?, sort_order=? WHERE id=?"
    ).run(
      pos,
      (title !== undefined ? title : cur.title) || null,
      (image_url || cur.image_url || "").trim(),
      (link_url !== undefined ? link_url : cur.link_url) || null,
      active === undefined ? cur.active : (active === false || active === 0 ? 0 : 1),
      sort_order === undefined ? cur.sort_order : (Number(sort_order) || 0),
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
      created_at: null,
      last_login: null,
      source: "env"
    });
  }
  const row = await db.prepare(
    "SELECT id, username, display_name, role, email, phone, created_at, last_login, updated_at FROM admins WHERE id = ?"
  ).get(req.admin.id);
  if (!row) return res.status(404).json({ error: "Admin not found" });
  res.json({ ...row, source: "db" });
});

app.put("/api/admin/profile", requireAuth, async (req, res) => {
  await ready();
  if (req.admin?._env) {
    return res.status(403).json({ error: "Profile is managed via Vercel env vars, not editable from UI" });
  }
  const { username, display_name, email, phone, current_password, new_password } = req.body || {};

  /* get current row */
  const cur = await db.prepare(
    "SELECT id, username, password, display_name, email, phone FROM admins WHERE id = ?"
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

  await db.prepare(
    "UPDATE admins SET username = ?, password = ?, display_name = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(newUsername, newHash, newDisplay, newEmail, newPhone, cur.id);

  res.json({
    ok: true,
    username: newUsername,
    display_name: newDisplay,
    email: newEmail,
    phone: newPhone
  });
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
    await db.prepare(
      "INSERT INTO page_views (news_id, path, ref, ua) VALUES (?, ?, ?, ?)"
    ).run(newsId, path, ref, ua);
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

app.post("/api/news", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const { title, category, subcategory, details, imageUrl, video } = req.body;
    if (!title || !category || !details) {
      return res.status(400).json({ error: "title, category, details are required" });
    }
    let image = null;
    if (req.file) {
      image = fileToDataUrl(req.file);
    } else if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      image = imageUrl;
    }
    const v = (typeof video === "string" && video.trim()) ? video.trim() : null;
    const sub = (typeof subcategory === "string" && subcategory.trim()) ? subcategory.trim() : null;
    const time = new Date().toLocaleString();
    const r = await db.prepare(
      "INSERT INTO news (title, category, subcategory, details, image, video, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(title, category, sub, details, image, v, time);
    const row = await db.prepare("SELECT * FROM news WHERE id = ?").get(r.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/news/:id", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const existing = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "News not found" });

    const { title, category, subcategory, details, imageUrl, video } = req.body;
    let image;
    if (req.file) {
      image = fileToDataUrl(req.file);
    } else if (typeof imageUrl === "string" && /^https?:\/\//.test(imageUrl)) {
      image = imageUrl;
    } else {
      image = existing.image;
    }
    let videoVal;
    if (typeof video === "string") {
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
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/news/:id", requireAuth, async (req, res) => {
  try {
    const existing = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "News not found" });
    await db.prepare("DELETE FROM news WHERE id = ?").run(req.params.id);
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/* ===== Serverless handler ===== */
export default async function handler(req, res) {
  await ready();
  return app(req, res);
}
