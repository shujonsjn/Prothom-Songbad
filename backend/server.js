/* ==========================================================
   SERVER.JS — Express + libSQL (Turso / local) + HTTP Basic Auth
   প্রথম সংবাদ — News backend
   Works both as standalone Node server AND Vercel serverless
   ========================================================== */

import express from "express";
import multer from "multer";
import path from "path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import db, { ready } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT        = process.env.PORT        || 3000;
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "1234";
const IS_SERVERLESS = !!process.env.VERCEL; // set automatically by Vercel

const app = express();

/* ===== Middleware ===== */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ===== Static (only in non-serverless mode; Vercel serves these directly) ===== */
if (!IS_SERVERLESS) {
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  app.use(express.static(path.join(__dirname, "..")));
}

/* ===== Basic Auth middleware ===== */
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

/* ===== Multer (memory storage — works on serverless) ===== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image and video files are allowed"));
  }
});

/* Convert multer file buffer → data URL for storage */
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

/* ===== PUBLIC API ===== */
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

/* Create category (auth) */
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

/* Delete category (auth) — only if no news uses it */
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

/* ===== ADMIN API (auth required) ===== */

app.get("/api/admin/check", requireAuth, (req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

/* Create */
app.post("/api/news", requireAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "videoFile", maxCount: 1 }]), async (req, res) => {
  try {
    const { title, category, subcategory, details, imageUrl, video } = req.body;
    if (!title || !category || !details) {
      return res.status(400).json({ error: "title, category, details are required" });
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

/* Update */
app.put("/api/news/:id", requireAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "videoFile", maxCount: 1 }]), async (req, res) => {
  try {
    const existing = await db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "News not found" });

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
    let v = video;
    const vidFile = req.files?.videoFile?.[0];
    if (vidFile) {
      v = fileToDataUrl(vidFile);
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

/* Delete */
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

/* ===== Admin Profile API ===== */
app.get("/api/admin/profile", requireAuth, async (req, res) => {
  await ready();
  try {
    const user = process.env.ADMIN_USER || "admin";
    const pass = process.env.ADMIN_PASS || "1234";
    const row = await db.prepare(
      "SELECT id, username, display_name, role, email, phone, created_at, last_login, updated_at FROM admins WHERE username = ?"
    ).get(user);
    if (!row) {
      return res.json({
        id: 0, username: user, display_name: "Editor", role: "admin",
        created_at: null, last_login: null, source: "env"
      });
    }
    res.json({ ...row, source: "db" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/profile", requireAuth, async (req, res) => {
  await ready();
  try {
    const { username, display_name, email, phone, current_password, new_password } = req.body || {};
    const user = process.env.ADMIN_USER || "admin";
    const pass = process.env.ADMIN_PASS || "1234";

    if (!username) return res.status(400).json({ error: "Username দিতে হবে" });

    let cur = await db.prepare("SELECT id, username, password, display_name FROM admins WHERE username = ?").get(user);
    if (!cur) {
      const hash = await bcrypt.hash(pass, 10);
      await db.prepare(
        "INSERT INTO admins (username, password, display_name, role) VALUES (?, ?, ?, ?)"
      ).run(user, hash, "Editor", "admin");
      cur = await db.prepare("SELECT id, username, password, display_name FROM admins WHERE username = ?").get(user);
    }

    if (new_password) {
      if (!current_password) return res.status(400).json({ error: "বর্তমান পাসওয়ার্ড দিতে হবে" });
      const ok = await bcrypt.compare(current_password, cur.password);
      if (!ok) return res.status(401).json({ error: "বর্তমান পাসওয়ার্ড ভুল" });
      if (new_password.length < 4) return res.status(400).json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষর হতে হবে" });
      const newHash = await bcrypt.hash(new_password, 10);
      await db.prepare(
        "UPDATE admins SET username = ?, display_name = ?, email = ?, phone = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(username, display_name || "", email || "", phone || "", newHash, cur.id);
    } else {
      await db.prepare(
        "UPDATE admins SET username = ?, display_name = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(username, display_name || "", email || "", phone || "", cur.id);
    }

    const updated = await db.prepare(
      "SELECT id, username, display_name, role, email, phone, created_at, last_login, updated_at FROM admins WHERE id = ?"
    ).get(cur.id);
    res.json({ ...updated, source: "db" });

    if (username !== user) {
      console.log(`[admin] username changed from "${user}" to "${username}" — restart to pick up new env override`);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== Subscribers API ===== */
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

app.get("/api/subscribers/export", requireAuth, async (req, res, next) => {
  try {
    const rows = await db.prepare(
      "SELECT * FROM subscribers ORDER BY created_at DESC"
    ).all();
    /* CSV export */
    const header = "Name,Phone,Email,Address,Source,Active,Created\n";
    const csv = header + rows.map(r =>
      `"${(r.name||"").replace(/"/g,'""')}","${(r.phone||"").replace(/"/g,'""')}","${(r.email||"").replace(/"/g,'""')}","${(r.address||"").replace(/"/g,'""')}","${(r.source||"").replace(/"/g,'""')}",${r.active ?? 1},"${r.created_at||""}"`
    ).join("\n");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", "attachment; filename=subscribers.csv");
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/* ===== Error handler ===== */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/* ===== Vercel serverless export ===== */
export default async function handler(req, res) {
  await ready();
  return app(req, res);
}

/* ===== Standalone server (only when run directly) ===== */
if (!IS_SERVERLESS && process.argv[1] && process.argv[1].endsWith("server.js")) {
  ready().then(() => {
    app.listen(PORT, () => {
      console.log("");
      console.log("  প্রথম সংবাদ — News Backend");
      console.log("  ────────────────────────────");
      console.log(`  ➜  http://localhost:${PORT}`);
      console.log(`  ➜  Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
      console.log(`  ➜  DB:    ${process.env.TURSO_URL ? "Turso (" + process.env.TURSO_URL + ")" : "local file"}`);
      console.log("");
    });
  });
}
