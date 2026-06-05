const { createClient } = require("@libsql/client");
(async () => {
  const c = createClient({
    url: "libsql://prothom-songbad-shujonsjn.aws-ap-south-1.turso.io",
    authToken: process.env.TURSO_TOKEN
  });
  const r = await c.execute("SELECT DISTINCT category, COUNT(*) as n FROM news GROUP BY category ORDER BY category");
  for (const row of r.rows) {
    console.log(`[${row.category}] n=${row.n}`);
  }
})();
