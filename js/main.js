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

  /* ===== Sub-category strip (breaking news-এর পরে) ===== */
  function renderSubStrip(){
    const strip = document.getElementById("subStrip");
    if(!strip) return;
    /* শুধু active category-এর সময় strip দেখাই */
    if(!activeCat || activeCat === "all"){
      strip.innerHTML = "";
      strip.style.display = "none";
      return;
    }
    /* subcategories:ready event ধরে window.SUBCATEGORIES পড়ি */
    const subs = (window.SUBCATEGORIES || {})[activeCat] || [];
    if(subs.length === 0){
      strip.innerHTML = "";
      strip.style.display = "none";
      return;
    }
    strip.style.display = "block";
    strip.innerHTML = `
      <div class="sub-strip-inner">
        <span class="sub-strip-label">${esc(activeCat)}</span>
        <span class="sub-strip-list">${
          subs.map(s => {
            const isActive = s === activeSub;
            const href = `index.html?cat=${encodeURIComponent(activeCat)}&sub=${encodeURIComponent(s)}`;
            return `<a href="${href}" class="sub-strip-link${isActive ? " active" : ""}">${esc(s)}</a>`;
          }).join('<span class="sub-strip-dot">•</span>')
        }</span>
      </div>`;
  }
  /* subcategories:ready event-এ strip re-render */
  window.addEventListener("subcategories:ready", renderSubStrip);
  /* initial attempt */
  setTimeout(renderSubStrip, 50);

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

  /* ===== "X মিনিট আগে" format helper ===== */
  function timeAgo(iso){
    if(!iso) return "";
    /* created_at is "YYYY-MM-DD HH:MM:SS" (UTC); assume BD = +6h */
    const isoNorm = iso.replace(" ", "T") + "Z";
    const d = new Date(isoNorm);
    if(isNaN(d.getTime())) return "";
    const now = new Date();
    let diffSec = Math.floor((now - d) / 1000);
    if(diffSec < 0) diffSec = 0;
    if(diffSec < 60)        return `${diffSec} সেকেন্ড আগে`;
    const diffMin = Math.floor(diffSec / 60);
    if(diffMin < 60)        return `${diffMin} মিনিট আগে`;
    const diffHr  = Math.floor(diffMin / 60);
    if(diffHr  < 24)        return `${diffHr} ঘণ্টা আগে`;
    const diffDay = Math.floor(diffHr / 24);
    if(diffDay < 30)        return `${diffDay} দিন আগে`;
    const diffMon = Math.floor(diffDay / 30);
    if(diffMon < 12)        return `${diffMon} মাস আগে`;
    return `${Math.floor(diffMon/12)} বছর আগে`;
  }

  /* Render one card in Prothom Alo style */
  function renderCard(n){
    const cat = esc(n.category || "সংবাদ");
    const title = esc(n.title);
    const excerpt = esc((n.details || "").slice(0, 140));
    const ago = esc(timeAgo(n.created_at));
    const vid = n.video ? `<span class="card-vid">▶</span>` : "";
    return `
      <article class="card-news" onclick="openNews(${n.id})">
        <div class="card-img">
          <img src="${esc(n.image)}" alt="" loading="lazy">
          ${vid}
        </div>
        <div class="card-body">
          <h2 class="card-title">
            <span class="card-cat">${cat}</span>
            <span class="card-sep">•</span>
            <span class="card-text">${title}</span>
          </h2>
          <p class="card-excerpt">${excerpt}…</p>
          <div class="card-meta">${ago}</div>
        </div>
      </article>`;
  }

  /* Hero block — 3 columns: 1 big (left) + 2 medium (middle, right) */
  function renderHero(news){
    if(news.length === 0) return "";
    const big   = news[0];
    const med1  = news[1];
    const med2  = news[2];

    const bigHtml = `
      <article class="hero-big" onclick="openNews(${big.id})">
        <img src="${esc(big.image)}" alt="" loading="eager">
        ${big.video ? `<span class="hero-vid">▶</span>` : ""}
        <div class="hero-big-title">
          <h2>${esc(big.title)}</h2>
          <div class="hero-big-meta">${esc(big.category)} • ${esc(timeAgo(big.created_at))}</div>
        </div>
      </article>`;

    const medHtml = (n) => n ? `
      <article class="hero-med" onclick="openNews(${n.id})">
        <div class="hero-med-img">
          <img src="${esc(n.image)}" alt="" loading="lazy">
          ${n.video ? `<span class="hero-vid-sm">▶</span>` : ""}
        </div>
        <h3 class="hero-med-title">${esc(n.title)}</h3>
        <p class="hero-med-excerpt">${esc((n.details || "").slice(0, 120))}…</p>
        <div class="hero-med-meta">${esc(timeAgo(n.created_at))}</div>
      </article>` : "";

    return `
      <div class="hero-block">
        <div class="hero-left">${bigHtml}</div>
        <div class="hero-right">
          ${medHtml(med1)}
          ${medHtml(med2)}
        </div>
      </div>`;
  }

  /* "আরও পড়ুন" text-only list (one row per news) */
  function renderListItem(n){
    return `
      <li class="read-more-item" onclick="openNews(${n.id})">
        <div class="rm-text">
          <h4 class="rm-title">${esc(n.title)}</h4>
          <div class="rm-meta">${esc(n.category || "সংবাদ")} • ${esc(timeAgo(n.created_at))}</div>
        </div>
        <div class="rm-thumb">
          <img src="${esc(n.image)}" alt="" loading="lazy">
          ${n.video ? `<span class="rm-vid">▶</span>` : ""}
        </div>
      </li>`;
  }

  /* ===== NEWS SLIDER (3 pages × 3 news each) ===== */
  function buildSlider(newsList){
    const slider = document.getElementById("newsSlider");
    const track  = document.getElementById("sliderTrack");
    const dots   = document.getElementById("sliderDots");
    if(!slider || !track || !dots) return;

    const perPage = 3;
    /* পরবর্তী ৯টা news (hero-এর পরের), যদি ৯ এর কম হয় skip */
    const pool = newsList.slice(3, 3 + perPage * 3);
    if(pool.length < perPage){
      slider.style.display = "none";
      return;
    }
    slider.style.display = "block";
    const pages = [];
    for(let i = 0; i < pool.length; i += perPage){
      const chunk = pool.slice(i, i + perPage);
      if(chunk.length === perPage) pages.push(chunk);
    }
    if(pages.length === 0){
      slider.style.display = "none";
      return;
    }

    /* Slides */
    track.innerHTML = pages.map((page, idx) => `
      <div class="slider-slide" data-page="${idx}">
        <div class="slider-grid">${page.map(renderCard).join("")}</div>
      </div>`).join("");

    /* Dots */
    dots.innerHTML = pages.map((_, idx) => `
      <button class="slider-dot${idx === 0 ? " active" : ""}" data-page="${idx}" aria-label="Page ${idx+1}"></button>`).join("");

    /* Active page state */
    let activePage = 0;
    function goTo(p){
      activePage = p;
      track.style.transform = `translateX(-${p * 100}%)`;
      dots.querySelectorAll(".slider-dot").forEach((d, i) => {
        d.classList.toggle("active", i === p);
      });
    }
    dots.querySelectorAll(".slider-dot").forEach(d => {
      d.addEventListener("click", () => goTo(Number(d.dataset.page)));
    });
  }

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

    /* Category title removed — sub-strip already shows the category name */

    /* Hero (first 3) + grid (rest) */
    const heroNews = data.slice(0, 3);
    const gridNews = data.slice(3);
    let html = renderHero(heroNews);
    if(gridNews.length){
      html += `<div class="card-grid">${gridNews.map(renderCard).join("")}</div>`;
    }
    mainNews.innerHTML = html;

    /* Slider: 3 pages × 3 news (news 4-12) */
    buildSlider(data);

    /* আরও পড়ুন — only show on category page, with all data as list */
    const readMore = document.getElementById("readMore");
    const readMoreWrap = document.getElementById("readMoreWrap");
    if(readMore && readMoreWrap){
      if(activeCat && activeCat !== "all" && data.length > 0){
        readMoreWrap.style.display = "block";
        readMore.innerHTML = data.map(renderListItem).join("");
      } else {
        readMoreWrap.style.display = "none";
      }
    }
  }

  /* ===== Sidebar ===== */
  function loadSidebar(){
    if(!sideNews) return;
    sideNews.innerHTML = "";
    data.slice(0,6).forEach(n => {
      const sv = n.video ? `<span class="vid-badge">▶</span>` : "";
      const details = (n.details || "").replace(/\s+/g, " ").trim();
      const excerpt = details.length > 90 ? details.slice(0, 90) + "…" : details;
      sideNews.innerHTML += `
        <div class="side-news" onclick="openNews(${n.id})">
          <img src="${esc(n.image)}" alt="">
          <div class="side-text">
            <h4 class="side-title">${esc(n.title)} ${sv}</h4>
            <p class="side-excerpt">${esc(excerpt)}</p>
            <div class="side-meta">${esc(n.category || "সংবাদ")} • ${esc(timeAgo(n.created_at))}</div>
          </div>
        </div>`;
    });
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
    })
    .catch(() => {
      if(mainNews) mainNews.innerHTML =
        `<div class="empty">সার্ভারের সাথে সংযোগ করা যাচ্ছে না<br><small style="font-size:14px;color:#6b6b6b;">Make sure the backend is running: <code>cd backend && npm start</code></small></div>`;
    });

})();
