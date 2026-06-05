/* ==========================================================
   SERVER.JS — Express + SQLite + HTTP Basic Auth
   প্রথম সংবাদ — News backend
   ========================================================== */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT        = process.env.PORT        || 3000;
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "1234";

const app = express();

/* ===== Middleware ===== */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ===== Static: uploads + project root ===== */
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

/* serve the rest of the project (index.html, NEWS.HTML, admin.html, css/, js/) */
app.use(express.static(path.join(__dirname, "..")));

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

/* ===== Multer (image uploads) ===== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const safeExt = /^\.(jpg|jpeg|png|gif|webp|svg)$/i.test(ext) ? ext : ".jpg";
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + safeExt;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

/* ===== PUBLIC API ===== */
app.get("/api/news", (req, res) => {
  const category = (req.query.category || "").toString().trim();
  let rows;
  if (category && category !== "all") {
    rows = db.prepare(
      "SELECT * FROM news WHERE category = ? ORDER BY id DESC"
    ).all(category);
  } else {
    rows = db.prepare("SELECT * FROM news ORDER BY id DESC").all();
  }
  res.json(rows);
});

app.get("/api/categories", (req, res) => {
  const rows = db.prepare(`
    SELECT c.name AS category, COUNT(n.id) AS count
    FROM categories c
    LEFT JOIN news n ON n.category = c.name
    GROUP BY c.name
    ORDER BY count DESC, c.name ASC
  `).all();
  res.json(rows);
});

/* Create category (auth) */
app.post("/api/categories", requireAuth, (req, res) => {
  const name = (req.body.name || "").toString().trim();
  if (!name) return res.status(400).json({ error: "Category name is required" });
  if (name.length > 40) return res.status(400).json({ error: "Name too long (max 40)" });
  const exists = db.prepare("SELECT 1 FROM categories WHERE name = ?").get(name);
  if (exists) return res.status(409).json({ error: "Category already exists" });
  db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
  res.status(201).json({ ok: true, name });
});

/* Delete category (auth) — only if no news uses it */
app.delete("/api/categories/:name", requireAuth, (req, res) => {
  const name = decodeURIComponent(req.params.name || "").trim();
  if (!name) return res.status(400).json({ error: "Category name is required" });
  const used = db.prepare("SELECT COUNT(*) AS c FROM news WHERE category = ?").get(name);
  if (used.c > 0) {
    return res.status(409).json({
      error: `“${name}” ক্যাটাগরিতে ${used.c}টি সংবাদ আছে — আগে সেগুলো মুছুন বা অন্য ক্যাটাগরিতে সরান`
    });
  }
  const r = db.prepare("DELETE FROM categories WHERE name = ?").run(name);
  if (r.changes === 0) return res.status(404).json({ error: "Category not found" });
  res.json({ ok: true, name });
});

app.get("/api/news/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "News not found" });
  res.json(row);
});

/* ===== ADMIN API (auth required) ===== */

/* Auth check — used by frontend to verify credentials */
app.get("/api/admin/check", requireAuth, (req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

/* Create */
app.post("/api/news", requireAuth, upload.single("image"), (req, res) => {
  const { title, category, details, imageUrl } = req.body;
  if (!title || !category || !details) {
    return res.status(400).json({ error: "title, category, details are required" });
  }
  let image = null;
  if (req.file) {
    image = "/uploads/" + req.file.filename;
  } else if (imageUrl && /^https?:\/\//.test(imageUrl)) {
    image = imageUrl;
  }
  const time  = new Date().toLocaleString();
  const r = db.prepare(
    "INSERT INTO news (title, category, details, image, time) VALUES (?, ?, ?, ?, ?)"
  ).run(title, category, details, image, time);
  const row = db.prepare("SELECT * FROM news WHERE id = ?").get(r.lastInsertRowid);
  res.status(201).json(row);
});

/* Update */
app.put("/api/news/:id", requireAuth, upload.single("image"), (req, res) => {
  const existing = db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "News not found" });

  const { title, category, details, imageUrl } = req.body;
  let image;
  if (req.file) {
    image = "/uploads/" + req.file.filename;
  } else if (typeof imageUrl === "string" && /^https?:\/\//.test(imageUrl)) {
    image = imageUrl;
  } else {
    image = existing.image;
  }

  db.prepare(
    "UPDATE news SET title = ?, category = ?, details = ?, image = ?, time = ? WHERE id = ?"
  ).run(
    title    ?? existing.title,
    category ?? existing.category,
    details  ?? existing.details,
    image,
    new Date().toLocaleString(),
    req.params.id
  );
  const row = db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
  res.json(row);
});

/* Delete */
app.delete("/api/news/:id", requireAuth, (req, res) => {
  const existing = db.prepare("SELECT * FROM news WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "News not found" });

  if (existing.image) {
    const fp = path.join(uploadsDir, path.basename(existing.image));
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    }
  }
  db.prepare("DELETE FROM news WHERE id = ?").run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

/* ===== Error handler ===== */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/* ===== Start ===== */
app.listen(PORT, () => {
  console.log("");
  console.log("  প্রথম সংবাদ — News Backend");
  console.log("  ────────────────────────────");
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`  ➜  DB:    ${path.join(__dirname, "data.db")}`);
  console.log("");
});
