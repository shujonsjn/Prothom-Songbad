// api/cron-update-screenshot.mjs
// GitHub Actions থেকে Puppeteer screenshot গ্রহণ করে DB-তে আপডেট করে
// Auth: ?secret=CRON_SECRET

import { createClient } from "@libsql/client";

const tursoUrl   = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || "";

const client = tursoUrl
  ? createClient({ url: tursoUrl, authToken: tursoToken })
  : createClient({ url: "file:./data.db" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const provided =
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") ||
    (req.query && req.query.secret) ||
    "";
  if (CRON_SECRET && provided !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { title, image, link } = req.body || {};
  if (!title || !image) {
    return res.status(400).json({ error: "title and image required" });
  }

  try {
    const existing = await client.execute({
      sql: "SELECT id, image FROM news WHERE title = ?",
      args: [title],
    });
    const row = existing.rows && existing.rows[0];

    if (row) {
      /* Update image — overrides old image with clean screenshot */
      await client.execute({
        sql: "UPDATE news SET image = ? WHERE id = ?",
        args: [image, row.id],
      });
      return res.json({ ok: true, id: Number(row.id), message: "Image updated" });
    }

    /* If article doesn't exist yet, insert a placeholder */
    const time = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
    const r = await client.execute({
      sql: "INSERT INTO news (title, category, details, image, time) VALUES (?, ?, ?, ?, ?)",
      args: [title, "সর্বশেষ", `সূত্র: ${link || ""}`, image, time],
    });
    return res.json({ ok: true, id: Number(r.lastInsertRowid), message: "Created with screenshot" });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
