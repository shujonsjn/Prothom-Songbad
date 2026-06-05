/* ==========================================================
   Vercel serverless entry — forwards all /api/* requests
   to the Express app in backend/server.js
   ========================================================== */

import handler from "../backend/server.js";

export default handler;
