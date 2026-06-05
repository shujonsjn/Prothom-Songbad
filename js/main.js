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

  /* ===== Active category from URL (nav.js handles highlighting) ===== */
  const params = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "all";

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
      const msg = activeCat && activeCat !== "all"
        ? `“${activeCat}” ক্যাটাগরিতে কোনো সংবাদ নেই`
        : `কোনো সংবাদ পাওয়া যায়নি`;
      mainNews.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    const hero = data[0];
    mainNews.innerHTML = `
      <div class="hero">
        <img src="${esc(hero.image)}" alt="">
        <div class="hero-content">
          <span class="eyebrow">Featured Story</span>
          <h1 onclick="openNews(${hero.id})">${esc(hero.title)}</h1>
          <p>${esc((hero.details || "").slice(0,250))}...</p>
        </div>
      </div>`;

    if(data.length > 1){
      mainNews.innerHTML += `<div class="news-grid" id="grid"></div>`;
      const grid = document.getElementById("grid");
      for(let i = 1; i < data.length; i++){
        const n = data[i];
        grid.innerHTML += `
          <div class="news">
            <img src="${esc(n.image)}" alt="">
            <div class="news-content">
              <h2 onclick="openNews(${n.id})">${esc(n.title)}</h2>
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
      sideNews.innerHTML += `
        <div class="side-news" onclick="openNews(${n.id})">
          <img src="${esc(n.image)}" alt="">
          <div class="side-title">${esc(n.title)}</div>
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
  const apiUrl = activeCat && activeCat !== "all"
    ? "/api/news?category=" + encodeURIComponent(activeCat)
    : "/api/news";

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
