/* ==========================================================
   DB.JS — SQLite setup & schema (using built-in node:sqlite)
   Requires Node.js >= 22.5.0 (stable in Node 23+/24)
   ========================================================== */

import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "data.db");

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    details     TEXT    NOT NULL,
    image       TEXT,
    time        TEXT    NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY
  )
`);

/* ===== Sync categories from existing news (one-time migration) ===== */
const existingCats = db.prepare(
  "SELECT DISTINCT category FROM news WHERE category IS NOT NULL AND category != ''"
).all();
const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
for (const r of existingCats) {
  if (r.category) insertCat.run(r.category);
}

/* ===== Seed data on first run ===== */
const countRow = db.prepare("SELECT COUNT(*) AS c FROM news").get();
if (countRow.c === 0) {
  const seed = db.prepare(
    "INSERT INTO news (title, category, details, image, time) VALUES (?, ?, ?, ?, ?)"
  );
  const now = new Date().toLocaleString();

  seed.run(
    "বাংলাদেশের অর্থনীতি ঘুরে দাঁড়াচ্ছে",
    "জাতীয়",
    "বাংলাদেশের অর্থনীতি ধীরে ধীরে শক্তিশালী হচ্ছে। নতুন বিনিয়োগ ও রপ্তানি বৃদ্ধির ফলে অর্থনৈতিক প্রবৃদ্ধি বাড়ছে।",
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c",
    now
  );
  seed.run(
    "আজকের খেলার বড় খবর",
    "খেলা",
    "আজ আন্তর্জাতিক ক্রিকেট ম্যাচে দুর্দান্ত জয় পেয়েছে বাংলাদেশ দল।",
    "https://images.unsplash.com/photo-1547347298-4074fc3086f0",
    now
  );
  seed.run(
    "বিশ্ববাজারে জ্বালানি তেলের দাম কমেছে",
    "আন্তর্জাতিক",
    "বিশ্ববাজারে তেলের দাম কমে যাওয়ায় দেশের বাজারেও ইতিবাচক প্রভাব পড়তে পারে।",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3",
    now
  );
  console.log("Seeded initial news data");
}

/* Helper: get a single row or null */
function getOne(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row || null;
}

/* Helper: get all rows */
function getAll(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/* Helper: run a statement, return lastInsertRowid */
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export { db, getOne, getAll, run };
export default db;
