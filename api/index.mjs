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
  /* পুরনো টেবিলে video কলাম নাও থাকতে পারে — যোগ করার চেষ্টা করি */
  try { await db.exec("ALTER TABLE news ADD COLUMN video TEXT"); } catch {}
  const existing = await db.prepare(
    "SELECT DISTINCT category FROM news WHERE category IS NOT NULL AND category != ''"
  ).all();
  for (const r of existing) {
    if (r.category) {
      await db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(r.category);
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

/* Basic auth */
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
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Admin", charset="UTF-8"');
  return res.status(401).json({ error: "Invalid credentials" });
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
    let rows;
    if (category && category !== "all") {
      rows = await db.prepare(
        "SELECT * FROM news WHERE category = ? ORDER BY id DESC"
      ).all(category);
    } else {
      rows = await db.prepare("SELECT * FROM news ORDER BY id DESC").all();
    }
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

/* ===== Admin API ===== */
app.get("/api/admin/check", requireAuth, (req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

app.post("/api/news", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const { title, category, details, imageUrl, video } = req.body;
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
    const time = new Date().toLocaleString();
    const r = await db.prepare(
      "INSERT INTO news (title, category, details, image, video, time) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(title, category, details, image, v, time);
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

    const { title, category, details, imageUrl, video } = req.body;
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

    await db.prepare(
      "UPDATE news SET title = ?, category = ?, details = ?, image = ?, video = ?, time = ? WHERE id = ?"
    ).run(
      title    ?? existing.title,
      category ?? existing.category,
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
