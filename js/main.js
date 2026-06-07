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

  /* Hero block — 1 big (left) + 1 tall medium card (right) with newspaper-style frame */
  function renderCategoryBanner(catName, totalCount){
    const today = new Date();
    const dateStr = today.toLocaleDateString("bn-BD",{
      weekday:"long", year:"numeric", month:"long", day:"numeric"
    });
    return `
      <section class="cat-banner">
        <div class="cat-banner-top">
          <div class="cat-banner-meta">
            <span class="cat-banner-eyebrow">ক্যাটাগরি</span>
            <span class="cat-banner-date">${esc(dateStr)}</span>
          </div>
          <div class="cat-banner-count">
            <strong>${totalCount}</strong>
            <span>টি সংবাদ</span>
          </div>
        </div>
        <h1 class="cat-banner-title">${esc(catName)}</h1>
        <div class="cat-banner-underline"></div>
        <p class="cat-banner-tagline">${esc(catName)} ক্যাটাগরির সর্বশেষ ও জনপ্রিয় সংবাদ, বিশ্লেষণ ও প্রতিবেদন</p>
      </section>`;
  }

  function renderHero(news){
    if(news.length === 0) return "";
    const big   = news[0];
    const med1  = news[1];

    const bigHtml = `
      <article class="hero-big" onclick="openNews(${big.id})">
        <img src="${esc(big.image)}" alt="" loading="eager">
        <div class="hero-big-overlay"></div>
        ${big.video ? `<span class="hero-vid">▶ ভিডিও</span>` : ""}
        <div class="hero-big-corner">★ এক্সক্লুসিভ</div>
        <div class="hero-big-title">
          <div class="hero-kicker">${esc(big.category || "সর্বশেষ")}</div>
          <h2>${esc(big.title)}</h2>
          <div class="hero-big-meta">
            <span class="hero-big-time">${esc(timeAgo(big.created_at))}</span>
            <span class="hero-big-read">বিস্তারিত পড়ুন →</span>
          </div>
        </div>
      </article>`;

    const medHtml = (n) => n ? `
      <article class="hero-med hero-med-tall" onclick="openNews(${n.id})">
        <div class="hero-med-img">
          <img src="${esc(n.image)}" alt="" loading="lazy">
          <div class="hero-med-img-shade"></div>
          ${n.video ? `<span class="hero-vid-sm">▶</span>` : ""}
          <div class="hero-med-img-cap">ছবি: সংগৃহীত</div>
        </div>
        <div class="hero-med-body">
          <div class="hero-kicker-sm">${esc(n.category || "সর্বশেষ")}</div>
          <h3 class="hero-med-title">${esc(n.title)}</h3>
          <p class="hero-med-excerpt">${esc((n.details || "").slice(0, 180))}…</p>
          <div class="hero-med-meta">
            <span>${esc(timeAgo(n.created_at))}</span>
            <span class="hero-med-arrow">→</span>
          </div>
        </div>
      </article>` : "";

    const sectionTitle = (activeCat && activeCat !== "all") ? activeCat : "প্রধান সংবাদ";
    const sectionTag   = (activeCat && activeCat !== "all") ? activeCat.toUpperCase() : "TOP STORIES";

    return `
      <section class="hero-section">
      <div class="section-bar">
        <span class="section-icon">◆</span>
        <h2 class="section-title">${esc(sectionTitle)}</h2>
        <span class="section-icon">◆</span>
        <div class="section-bar-line"></div>
        <span class="section-tag">${esc(sectionTag)}</span>
      </div>
        <div class="hero-block">
          <div class="hero-left">${bigHtml}</div>
          <div class="hero-right">
            ${medHtml(med1)}
          </div>
        </div>
      </section>`;
  }

  /* "আরও পড়ুন" text-only list (one row per news) */
  function renderListItem(n){
    const details = (n.details || "").replace(/\s+/g, " ").trim();
    const excerpt = details.length > 100 ? details.slice(0, 100) + "…" : details;
    return `
      <li class="read-more-item" onclick="openNews(${n.id})">
        <div class="rm-text">
          <h4 class="rm-title">${esc(n.title)}</h4>
          <p class="rm-excerpt">${esc(excerpt)}</p>
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
    let html = "";
    if(activeCat && activeCat !== "all"){
      html += renderCategoryBanner(activeCat, data.length);
    }
    html += renderHero(heroNews);
    if(gridNews.length){
      html += `<div class="card-grid">${gridNews.map(renderCard).join("")}</div>`;
    }
    mainNews.innerHTML = html;

    /* Slider: 3 pages × 3 news (news 4-12) */
    buildSlider(data);

    /* আরও পড়ুন — only show on category page, paginated 10-at-a-time */
    const readMore = document.getElementById("readMore");
    const readMoreWrap = document.getElementById("readMoreWrap");
    const loadMoreBtn = document.getElementById("loadMore");
    if(readMore && readMoreWrap){
      if(activeCat && activeCat !== "all" && data.length > 0){
        readMoreWrap.style.display = "block";
        let showCount = 10;
        function paintReadMore(){
          readMore.innerHTML = data.slice(0, showCount).map(renderListItem).join("");
          if(loadMoreBtn){
            if(showCount >= data.length){
              loadMoreBtn.style.display = "none";
            } else {
              loadMoreBtn.style.display = "block";
              const remaining = data.length - showCount;
              loadMoreBtn.textContent = `আরও ${Math.min(10, remaining)}টি দেখান`;
            }
          }
        }
        paintReadMore();
        if(loadMoreBtn){
          loadMoreBtn.onclick = () => {
            showCount = Math.min(showCount + 10, data.length);
            paintReadMore();
          };
        }
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
    loadSidebarBanners();
  }

  /* ===== Sidebar banners (public) ===== */
  function renderBannerHtml(rows){
    return rows.map(b => {
      const link = b.link_url || "#";
      const target = /^https?:\/\//i.test(link) && !link.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : '';
      return '<a class="sidebar-banner" href="' + esc(link) + '"' + target + ' data-pos="' + esc(b.position) + '">' +
        '<span class="sidebar-banner-label">বিজ্ঞাপন</span>' +
        '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || "ad") + '" loading="lazy">' +
        (b.title ? '<span class="sidebar-banner-link">' + esc(b.title) + '</span>' : '') +
      '</a>';
    }).join("");
  }

  function loadSidebarBanners(){
    /* fetch every position separately so the home page shows them all */
    const positions = ["sidebar-top", "sidebar-bottom", "header", "footer", "inline"];
    Promise.all(positions.map(pos =>
      fetch("/api/banners?position=" + pos + "&_=" + Date.now())
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    )).then(([topRows, bottomRows, headerRows, footerRows, inlineRows]) => {
      /* sidebar-top: inject above "সর্বাধিক পঠিত" */
      const sidebar = document.querySelector(".sidebar");
      let topWrap = document.getElementById("sidebarBannersTop");
      if(!topWrap && sidebar){
        topWrap = document.createElement("div");
        topWrap.id = "sidebarBannersTop";
        topWrap.className = "sidebar-banners";
        const h3 = sidebar.querySelector("h3");
        if(h3) h3.insertAdjacentElement("afterend", topWrap);
        else   sidebar.insertBefore(topWrap, sidebar.firstChild);
      }
      if(topWrap){
        topWrap.innerHTML = (topRows && topRows.length) ? renderBannerHtml(topRows) : "";
      }
      /* sidebar-bottom: existing slot below the news list */
      const wrap = document.getElementById("sidebarBanners");
      if(wrap){
        wrap.innerHTML = (bottomRows && bottomRows.length) ? renderBannerHtml(bottomRows) : "";
      }
      /* header: top of page */
      const hdr = document.getElementById("headerBanners");
      if(hdr) hdr.innerHTML = (headerRows && headerRows.length) ? renderFullBannerHtml(headerRows) : "";
      /* footer: bottom of page (above <footer> element) */
      const ftr = document.getElementById("footerBanners");
      if(ftr) ftr.innerHTML = (footerRows && footerRows.length) ? renderFullBannerHtml(footerRows) : "";
      /* inline: between main content blocks */
      const inl1 = document.getElementById("inlineBanner1");
      if(inl1){
        const html = (inlineRows && inlineRows.length) ? renderFullBannerHtml(inlineRows) : "";
        inl1.innerHTML = html;
        inl1.style.display = html ? "" : "none";
      }
      const inl2 = document.getElementById("inlineBanner2");
      if(inl2){
        const html = (inlineRows && inlineRows.length) ? renderFullBannerHtml(inlineRows) : "";
        inl2.innerHTML = html;
        inl2.style.display = html ? "" : "none";
      }
    });
  }

  function renderFullBannerHtml(rows){
    return rows.map(b => {
      const link = b.link_url || "#";
      const target = /^https?:\/\//i.test(link) && !link.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : '';
      return '<a class="full-banner" href="' + esc(link) + '"' + target + ' data-pos="' + esc(b.position) + '">' +
        '<span class="full-banner-label">বিজ্ঞাপন</span>' +
        '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || "ad") + '" loading="lazy">' +
      '</a>';
    }).join("");
  }

  /* ===== Fetch from API ===== */
  const qp = new URLSearchParams();
  if(activeCat && activeCat !== "all") qp.set("category", activeCat);
  if(activeSub)                       qp.set("sub", activeSub);
  const apiUrl = "/api/news" + (qp.toString() ? "?" + qp.toString() : "");

  /* page-view tracking (fire-and-forget) */
  try {
    const body = JSON.stringify({ path: window.location.pathname + window.location.search });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track-view", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track-view", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {}

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
