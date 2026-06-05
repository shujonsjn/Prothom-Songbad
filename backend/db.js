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
      details     TEXT    NOT NULL,
      image       TEXT,
      time        TEXT    NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
})();

/* Block until schema is ready (call before any DB operation) */
export async function ready() {
  await schemaReady;
}

export default db;
