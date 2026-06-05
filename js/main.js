/* ==========================================================
   MAIN.JS — Index page logic (fetches from API)
   ========================================================== */

(function(){

  /* ===== Date ===== */
  const dateEl = document.getElementById("date");
  if(dateEl){
    const today = new Date();
    dateEl.innerText = today.toLocaleDateString("bn-BD",{
      weekday:"long", year:"numeric", month:"long", day:"numeric"
    });
  }

  const mainNews = document.getElementById("mainNews");
  const sideNews = document.getElementById("sideNews");
  const ticker   = document.getElementById("ticker");

  /* ===== Active category + sub-category from URL ===== */
  const params = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "all";
  const activeSub = params.get("sub") || null;

  let data = [];

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }

  /* ===== Open news detail ===== */
  window.openNews = function(id){
    window.location.href = "news.html?id=" + id;
  };

  /* ===== Main news ===== */
  function loadNews(){
    if(!mainNews) return;
    if(data.length === 0){
      const msg = activeSub
        ? `“${activeSub}” সাব-ক্যাটাগরিতে এখনো কোনো সংবাদ নেই`
        : activeCat && activeCat !== "all"
          ? `“${activeCat}” ক্যাটাগরিতে কোনো সংবাদ নেই`
          : `কোনো সংবাদ পাওয়া যায়নি`;
      mainNews.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    /* Active sub-category tag */
    if(activeSub && activeCat && activeCat !== "all"){
      const tag = document.createElement("div");
      tag.className = "active-sub-tag";
      tag.innerHTML = `<a href="index.html?cat=${encodeURIComponent(activeCat)}">${esc(activeCat)}</a> <span>›</span> <strong>${esc(activeSub)}</strong>`;
      mainNews.parentNode.insertBefore(tag, mainNews);
    }

    const hero = data[0];
    const heroVid = hero.video ? `<span class="vid-badge">▶ ভিডিও</span>` : "";
    mainNews.innerHTML = `
      <div class="hero">
        <img src="${esc(hero.image)}" alt="">
        <div class="hero-content">
          <span class="eyebrow">Featured Story</span>
          <h1 onclick="openNews(${hero.id})">${esc(hero.title)}${heroVid}</h1>
          <p>${esc((hero.details || "").slice(0,250))}...</p>
        </div>
      </div>`;

    if(data.length > 1){
      mainNews.innerHTML += `<div class="news-grid" id="grid"></div>`;
      const grid = document.getElementById("grid");
      for(let i = 1; i < data.length; i++){
        const n = data[i];
        const nv = n.video ? `<span class="vid-badge">▶</span>` : "";
        grid.innerHTML += `
          <div class="news">
            <img src="${esc(n.image)}" alt="">
            <div class="news-content">
              <h2 onclick="openNews(${n.id})">${esc(n.title)} ${nv}</h2>
              <p>${esc((n.details || "").slice(0,120))}...</p>
            </div>
          </div>`;
      }
    }
  }

  /* ===== Sidebar ===== */
  function loadSidebar(){
    if(!sideNews) return;
    sideNews.innerHTML = "";
    data.slice(0,6).forEach(n => {
      const sv = n.video ? `<span class="vid-badge">▶</span>` : "";
      sideNews.innerHTML += `
        <div class="side-news" onclick="openNews(${n.id})">
          <img src="${esc(n.image)}" alt="">
          <div class="side-title">${esc(n.title)} ${sv}</div>
        </div>`;
    });
  }

  /* ===== Ticker ===== */
  function loadTicker(){
    if(!ticker) return;
    ticker.innerText = data.length
      ? data.map(n => "• " + n.title).join("   |   ")
      : "Breaking news loading...";
  }

  /* ===== Fetch from API ===== */
  const qp = new URLSearchParams();
  if(activeCat && activeCat !== "all") qp.set("category", activeCat);
  if(activeSub)                       qp.set("sub", activeSub);
  const apiUrl = "/api/news" + (qp.toString() ? "?" + qp.toString() : "");

  fetch(apiUrl)
    .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    .then(rows => {
      data = rows || [];
      loadNews();
      loadSidebar();
      loadTicker();
    })
    .catch(() => {
      if(mainNews) mainNews.innerHTML =
        `<div class="empty">সার্ভারের সাথে সংযোগ করা যাচ্ছে না<br><small style="font-size:14px;color:#6b6b6b;">Make sure the backend is running: <code>cd backend && npm start</code></small></div>`;
      if(ticker) ticker.innerText = "Server unreachable";
    });

})();
