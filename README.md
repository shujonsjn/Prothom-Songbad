# প্রথম সংবাদ — Prothom Songbad

বাংলা ভাষার একটি আধুনিক অনলাইন সংবাদপত্র — Node.js + Express + SQLite ব্যাকেন্ড এবং plain HTML/CSS/JS ফ্রন্টেন্ড দিয়ে তৈরি।

## Features

- 🗞️ **Hero + grid + sidebar** layout (newspaper style)
- 🏷️ **Dynamic category navbar** — admin যেসব ক্যাটাগরি add করে, সেগুলো navbar-এ দেখায়
- ✍️ **Admin panel** — add / edit / delete news (HTTP Basic Auth)
- 🗂️ **Category management** — ক্যাটাগরি add / delete (যদি কোনো খবর ব্যবহার না করে)
- 📸 **Image upload** — file upload অথবা external image URL দুই-ই সম্ভব
- 🔍 **Category filtering** — navbar থেকে ক্যাটাগরি অনুযায়ী খবর দেখা যায়

## Tech Stack

- **Backend:** Node.js (>= 22.5), Express, node:sqlite, Multer
- **Frontend:** Vanilla HTML / CSS / JS
- **DB:** SQLite (single-file, built-in)

## Project Structure

```
.
├── index.html         # Home page (hero + grid + sidebar)
├── news.html          # News detail page
├── admin.html         # Admin panel (login + CRUD)
├── css/
│   ├── theme.css      # Public pages styles
│   └── admin.css      # Admin panel styles
├── js/
│   ├── nav.js         # Dynamic navbar (loads categories from API)
│   ├── main.js        # Home page logic
│   ├── news.js        # News detail page logic
│   └── admin.js       # Admin panel logic
└── backend/
    ├── server.js      # Express server
    ├── db.js          # SQLite schema + seed
    ├── seed-extra.js  # Extra news seeder (5 per category)
    ├── package.json
    └── .gitignore
```

## Quick Start

```bash
cd backend
npm install
npm start
```

তারপর browser-এ:
- Home: http://localhost:3000/
- News detail: http://localhost:3000/news.html?id=1
- Admin: http://localhost:3000/admin.html (default: `admin` / `1234`)

Environment variables:
- `PORT` (default: `3000`)
- `ADMIN_USER` (default: `admin`)
- `ADMIN_PASS` (default: `1234`)

## API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/news` | — | List all news (`?category=X` দিয়ে filter) |
| GET | `/api/news/:id` | — | Single news |
| GET | `/api/categories` | — | List categories with news count |
| POST | `/api/categories` | Basic | Create category `{name}` |
| DELETE | `/api/categories/:name` | Basic | Delete category (only if unused) |
| GET | `/api/admin/check` | Basic | Verify credentials |
| POST | `/api/news` | Basic | Create news (multipart: `title`, `category`, `details`, `image` file, `imageUrl`) |
| PUT | `/api/news/:id` | Basic | Update news |
| DELETE | `/api/news/:id` | Basic | Delete news (and its image) |

## License

MIT
