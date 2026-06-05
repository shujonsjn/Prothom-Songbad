/* ==========================================================
   NAV.JS — Shared dynamic navbar (loads categories from API)
   Used on index.html & news.html
   ========================================================== */

(function(){

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }

  const params  = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "all";

  function render(cats){
    const menu = document.getElementById("navMenu");
    if(!menu) return;

    const allLink = `<a href="index.html" data-cat="all"${activeCat === "all" ? ' class="active"' : ""}>সর্বশেষ</a>`;
    const catLinks = (cats || []).map(c =>
      `<a href="index.html?cat=${encodeURIComponent(c.category)}" data-cat="${esc(c.category)}"${activeCat === c.category ? ' class="active"' : ""}>${esc(c.category)}</a>`
    ).join("");

    menu.innerHTML = allLink + catLinks;
  }

  fetch("/api/categories")
    .then(r => r.ok ? r.json() : [])
    .then(render)
    .catch(() => {
      const menu = document.getElementById("navMenu");
      if(menu) menu.innerHTML = `<a href="index.html" data-cat="all" class="active">সর্বশেষ</a>`;
    });

})();
