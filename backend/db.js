/* ==========================================================
   DB.JS — libSQL (Turso / local file) wrapper
   Works in two modes:
     - Production: TURSO_URL + TURSO_TOKEN env vars → Turso cloud
     - Development: no env vars → local SQLite file
   ========================================================== */

import { createClient } from "@libsql/client";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;

const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: `file:${path.join(__dirname, "data.db")}` });

/* ===== Promise-based statement wrapper (mimics better-sqlite3) ===== */
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
    return { lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined, changes: r.rowsAffected };
  }
}

class DB {
  prepare(sql) { return new Statement(sql); }
  async exec(sql) { await client.execute(sql); }
}

const db = new DB();

/* ===== Schema init (runs on first DB call) ===== */
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
  /* self-healing: add columns to news if missing */
  try { await db.exec("ALTER TABLE news ADD COLUMN subcategory TEXT"); } catch {}
  try { await db.exec("ALTER TABLE news ADD COLUMN video TEXT"); } catch {}
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
      name TEXT PRIMARY KEY
    )
  `);

  /* Migrate existing news categories into categories table */
  const existing = await db.prepare(
    "SELECT DISTINCT category FROM news WHERE category IS NOT NULL AND category != ''"
  ).all();
  for (const r of existing) {
    if (r.category) {
      await db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(r.category);
    }
  }

  /* Article images table (multiple images per article) */
  await db.exec(`
    CREATE TABLE IF NOT EXISTS news_images (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id    INTEGER NOT NULL,
      image_url  TEXT    NOT NULL,
      caption    TEXT    DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
    )
  `);

  /* ===== Admin profile table ===== */
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
  try { await db.exec("ALTER TABLE admins ADD COLUMN email TEXT"); } catch {}
  try { await db.exec("ALTER TABLE admins ADD COLUMN phone TEXT"); } catch {}
  /* seed default admin if none exists */
  const adminCount = await db.prepare("SELECT COUNT(*) AS c FROM admins").get();
  if ((adminCount?.c || 0) === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const seedUser = process.env.ADMIN_USER || "admin";
    const seedPass = process.env.ADMIN_PASS || "1234";
    const seedHash = await bcrypt.hash(seedPass, 10);
    const seedName = process.env.ADMIN_DISPLAY_NAME || "Editor";
    await db.prepare(
      "INSERT INTO admins (username, password, display_name, role) VALUES (?, ?, ?, ?)"
    ).run(seedUser, seedHash, seedName, "admin");
  }
})();

/* Block until schema is ready (call before any DB operation) */
export async function ready() {
  await schemaReady;
}

export default db;
