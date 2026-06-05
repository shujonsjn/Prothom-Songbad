/* ==========================================================
   NAV.JS — Dynamic top nav + mega-menu dropdown
   Loads categories from /api/categories and renders links.
   On hover (or focus), shows a Prothom Alo-style sub-category
   panel below the nav with the category name (large) and a
   row of sub-categories separated by " • ".
   ========================================================== */

(function(){

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }

  const params  = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "all";

  function buildSubRow(cat, subs){
    if(!subs || subs.length === 0) return "";
    return `<div class="nav-sub-row">${
      subs.map((s, i) => {
        const sep = i > 0 ? '<span class="dot">•</span>' : "";
        const href = `index.html?cat=${encodeURIComponent(cat)}&sub=${encodeURIComponent(s)}`;
        return `${sep}<a href="${href}">${esc(s)}</a>`;
      }).join("")
    }</div>`;
  }

  function buildPanel(cat, subs){
    return `
      <div class="nav-panel" data-cat="${esc(cat)}">
        <a class="nav-panel-title" href="index.html?cat=${encodeURIComponent(cat)}">${esc(cat)}</a>
        ${buildSubRow(cat, subs)}
      </div>`;
  }

  let openTimer = null;
  let currentOpen = null;

  function openPanel(cat){
    if(currentOpen === cat) return;
    closePanel();
    const dd = document.getElementById("navDropdown");
    if(!dd) return;
    const subs = (window.SUBCATEGORIES || {})[cat] || [];
    dd.innerHTML = buildPanel(cat, subs);
    dd.classList.add("open");
    currentOpen = cat;
  }
  function closePanel(){
    const dd = document.getElementById("navDropdown");
    if(!dd) return;
    dd.classList.remove("open");
    dd.innerHTML = "";
    currentOpen = null;
  }

  function render(cats){
    const menu = document.getElementById("navMenu");
    if(!menu) return;

    const allLink = `<a href="index.html" data-cat="all"${activeCat === "all" ? ' class="active"' : ""}>সর্বশেষ</a>`;
    const catLinks = (cats || []).map(c =>
      `<a href="index.html?cat=${encodeURIComponent(c.category)}" data-cat="${esc(c.category)}"${activeCat === c.category ? ' class="active"' : ""}>${esc(c.category)}</a>`
    ).join("");

    menu.innerHTML = allLink + catLinks;

    /* hover handlers — desktop */
    let hoveringPanel = false;
    const dd = document.getElementById("navDropdown");

    if(dd){
      dd.addEventListener("mouseenter", () => { hoveringPanel = true; clearTimeout(openTimer); });
      dd.addEventListener("mouseleave", () => { hoveringPanel = false; scheduleClose(); });
    }
    function scheduleClose(){
      clearTimeout(openTimer);
      openTimer = setTimeout(() => { if(!hoveringPanel) closePanel(); }, 180);
    }

    menu.querySelectorAll("a[data-cat]").forEach(a => {
      const cat = a.getAttribute("data-cat");
      if(cat === "all") return;
      a.addEventListener("mouseenter", () => { clearTimeout(openTimer); openPanel(cat); });
      a.addEventListener("mouseleave", scheduleClose);
      /* mobile / touch — tap toggles */
      a.addEventListener("click", (e) => {
        if(window.matchMedia("(hover: none)").matches){
          if(currentOpen === cat){ closePanel(); return; }
          e.preventDefault();
          openPanel(cat);
        }
      });
    });

    /* ESC বা outside click এ বন্ধ */
    document.addEventListener("keydown", (e) => { if(e.key === "Escape") closePanel(); });
    document.addEventListener("click", (e) => {
      if(!e.target.closest("#navMenu") && !e.target.closest("#navDropdown")) closePanel();
    });
  }

  fetch("/api/categories")
    .then(r => r.ok ? r.json() : [])
    .then(render)
    .catch(() => {
      const menu = document.getElementById("navMenu");
      if(menu) menu.innerHTML = `<a href="index.html" data-cat="all" class="active">সর্বশেষ</a>`;
    });

})();
