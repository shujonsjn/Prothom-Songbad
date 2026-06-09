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
          <img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.parentElement.classList.add('img-missing')">
          ${vid}
        </div>
        <div class="card-body">
          <h2 class="card-title">
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
    const med2  = news[2];

    const bigHtml = `
      <article class="hero-big" onclick="openNews(${big.id})">
        <img src="${esc(big.image)}" alt="" loading="eager" referrerpolicy="no-referrer" onerror="this.onerror=null;this.parentElement.classList.add('img-missing')">
        <div class="hero-big-overlay"></div>
        ${big.video ? `<span class="hero-vid">▶ ভিডিও</span>` : ""}
        <div class="hero-big-title">
          <h2>${esc(big.title)}</h2>
          <div class="hero-big-meta">
            <span class="hero-big-time">${esc(timeAgo(big.created_at))}</span>
          </div>
        </div>
      </article>`;

    const medHtml = (n) => n ? `
      <article class="hero-med" onclick="openNews(${n.id})">
        <div class="hero-med-img">
          <img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.parentElement.classList.add('img-missing')">
          <div class="hero-med-img-shade"></div>
          ${n.video ? `<span class="hero-vid-sm">▶</span>` : ""}
        </div>
        <div class="hero-med-body">
          <h3 class="hero-med-title">${esc(n.title)}</h3>
          <div class="hero-med-meta">
            <span class="hero-med-time">${esc(timeAgo(n.created_at))}</span>
          </div>
        </div>
      </article>` : "";

    return `
      <section class="hero-section">
      <div class="section-bar">
        <div class="section-bar-line"></div>
      </div>
        <div class="hero-block">
          <div class="hero-left">${bigHtml}</div>
          <div class="hero-right">
            ${medHtml(med1)}
            ${medHtml(med2)}
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
          <img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.parentElement.classList.add('img-missing')">
          ${n.video ? `<span class="rm-vid">▶</span>` : ""}
        </div>
      </li>`;
  }

  /* ===== POPULAR SLIDER (1 news per slide, dot navigation) ===== */
  function buildPopularSlider(newsList){
    const slider = document.getElementById("popularSlider");
    const track  = document.getElementById("popularTrack");
    const dots   = document.getElementById("popularDots");
    if(!slider || !track || !dots || newsList.length === 0){
      if(slider) slider.style.display = "none";
      return;
    }
    slider.style.display = "block";

    /* Slides — 1 news per slide */
    track.innerHTML = newsList.map((n, idx) => {
      const details = (n.details || "").replace(/\s+/g, " ").trim();
      const excerpt = details.length > 120 ? details.slice(0, 120) + "…" : details;
      return `<div class="slider-slide" data-page="${idx}">
        <article class="popular-card" onclick="openNews(${n.id})">
          <img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.parentElement.classList.add('img-missing')">
          <div class="popular-body">
            <h3 class="popular-title">${esc(n.title)}</h3>
            <p class="popular-excerpt">${esc(excerpt)}</p>
            <div class="popular-meta">${esc(n.category || "সংবাদ")} • ${esc(timeAgo(n.created_at))}</div>
          </div>
        </article>
      </div>`;
    }).join("");

    /* Dots */
    dots.innerHTML = newsList.map((_, idx) => `
      <button class="slider-dot${idx === 0 ? " active" : ""}" data-page="${idx}" aria-label="Page ${idx+1}"></button>`).join("");

    /* Active page state + auto-play */
    let activePage = 0;
    let autoTimer = null;
    function goTo(p){
      activePage = p;
      track.style.transform = `translateX(-${p * 100}%)`;
      dots.querySelectorAll(".slider-dot").forEach((d, i) => {
        d.classList.toggle("active", i === p);
      });
    }
    function autoNext(){
      goTo((activePage + 1) % newsList.length);
    }
    function startAuto(){
      stopAuto();
      autoTimer = setInterval(autoNext, 2000);
    }
    function stopAuto(){
      if(autoTimer){ clearInterval(autoTimer); autoTimer = null; }
    }
    dots.querySelectorAll(".slider-dot").forEach(d => {
      d.addEventListener("click", () => { goTo(Number(d.dataset.page)); startAuto(); });
    });
    slider.addEventListener("mouseenter", stopAuto);
    slider.addEventListener("mouseleave", startAuto);
    startAuto();
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

    /* Hero (3) + সর্বশেষ (6 grid) + জনপ্রিয় (3 slider) + আরও খবর (10/list) */
    const heroNews = data.slice(0, 3);
    const restNews = data.slice(3);
    const latestNews = restNews.slice(0, 6);
    const popularNews = restNews.slice(6, 11);
    const moreNews = restNews.slice(9);

    let html = renderHero(heroNews);

    if(latestNews.length){
      html += `<div class="section-heading"><span class="section-heading-label">সর্বশেষ</span><span class="section-heading-line"></span></div>`;
      html += `<div class="card-grid">${latestNews.map(renderCard).join("")}</div>`;
    }

    mainNews.innerHTML = html;

    /* জনপ্রিয় — slider (3 news, 1 per slide) */
    buildPopularSlider(popularNews);

    /* আরও খবর — stacked list, paginated 10-at-a-time */
    const readMore = document.getElementById("readMore");
    const readMoreWrap = document.getElementById("readMoreWrap");
    const loadMoreBtn = document.getElementById("loadMore");
    if(readMore && readMoreWrap && moreNews.length > 0){
      readMoreWrap.style.display = "block";
      let showCount = 10;
      function paintReadMore(){
        readMore.innerHTML = moreNews.slice(0, showCount).map(renderListItem).join("");
        if(loadMoreBtn){
          if(showCount >= moreNews.length){
            loadMoreBtn.style.display = "none";
          } else {
            loadMoreBtn.style.display = "block";
            const remaining = moreNews.length - showCount;
            loadMoreBtn.textContent = `আরও`;
          }
        }
      }
      paintReadMore();
      if(loadMoreBtn){
        loadMoreBtn.onclick = () => {
          showCount = Math.min(showCount + 10, moreNews.length);
          paintReadMore();
        };
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
    renderSubscribeWidget();
  }

  /* ===== Sidebar banners (public) ===== */
  function renderBannerHtml(rows){
    return rows.map(b => {
      const link = b.link_url || "#";
      const target = /^https?:\/\//i.test(link) && !link.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : '';
      const w = b.width  ? ' width="'  + Number(b.width)  + '"' : '';
      const h = b.height ? ' height="' + Number(b.height) + '"' : '';
      const style = (b.width || b.height) ? ' style="' + (b.width  ? 'max-width:'  + b.width  + 'px;' : '') + (b.height ? 'max-height:' + b.height + 'px;' : '') + (b.width ? 'width:' + b.width + 'px;' : '') + (b.height ? 'height:' + b.height + 'px;' : '') + '"' : '';
      return '<a class="sidebar-banner" href="' + esc(link) + '"' + target + ' data-pos="' + esc(b.position) + '">' +
        '<span class="sidebar-banner-label"></span>' +
        '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || "ad") + '" loading="lazy"' + w + h + style + '>' +
        (b.title ? '<span class="sidebar-banner-link">' + esc(b.title) + '</span>' : '') +
      '</a>';
    }).join("");
  }

  function loadSidebarBanners(){
    /* fetch every position separately so the home page shows them all */
    const positions = ["sidebar-top", "sidebar-bottom", "header", "footer", "inline", "nav-bottom"];
    Promise.all(positions.map(pos =>
      fetch("/api/banners?position=" + pos + "&_=" + Date.now())
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    )).then(([topRows, bottomRows, headerRows, footerRows, inlineRows, navRows]) => {
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
      /* nav-bottom: below navigation, above content */
      const navBnr = document.getElementById("navBanner");
      if(navBnr){
        const html = (navRows && navRows.length) ? renderFullBannerHtml(navRows) : "";
        navBnr.innerHTML = html;
        navBnr.style.display = html ? "" : "none";
      }
    });
  }

  /* ===== Subscribe widget (sidebar) ===== */
  function renderSubscribeWidget(){
    const wrap = document.getElementById("subscribeWidget");
    if(!wrap) return;
    wrap.innerHTML = `
      <div class="subscribe-box">
        <h4 class="subscribe-title">নিউজলেটার</h4>
        <p class="subscribe-desc">সর্বশেষ সংবাদ পেতে নিবন্ধন করুন</p>
        <div id="subscribeForm" class="subscribe-form">
          <input id="subName" type="text" placeholder="আপনার নাম" autocomplete="name">
          <input id="subPhone" type="tel" placeholder="মোবাইল নম্বর" autocomplete="tel">
          <input id="subEmail" type="email" placeholder="ইমেইল" autocomplete="email">
          <input id="subPass" type="password" placeholder="পাসওয়ার্ড (ন্যূনতম ৪ অক্ষর)" autocomplete="new-password">
          <button type="button" class="sub-submit" onclick="submitSubscribe()">নিবন্ধন</button>
          <div id="subMsg" class="sub-msg"></div>
        </div>
        <a href="/profile.html" class="manage-sub-link">আপনার প্রোফাইল দেখুন →</a>
      </div>`;
  }

  window.submitSubscribe = function(){
    const name = document.getElementById("subName");
    const phone = document.getElementById("subPhone");
    const email = document.getElementById("subEmail");
    const pass = document.getElementById("subPass");
    const msg = document.getElementById("subMsg");
    if(!name || !phone || !email || !pass || !msg) return;
    if(!name.value.trim()){ msg.textContent = "নাম লিখুন"; msg.style.color="#c1131d"; return; }
    if(!phone.value.trim()){ msg.textContent = "মোবাইল নম্বর লিখুন"; msg.style.color="#c1131d"; return; }
    if(!email.value.trim()){ msg.textContent = "ইমেইল লিখুন"; msg.style.color="#c1131d"; return; }
    if(pass.value.length < 4){ msg.textContent = "পাসওয়ার্ড কমপক্ষে ৪ অক্ষর"; msg.style.color="#c1131d"; return; }
    msg.textContent = "নিবন্ধন হচ্ছে...";
    msg.style.color = "#888";
    fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.value.trim(),
        phone: phone.value.trim(),
        email: email.value.trim(),
        password: pass.value
      })
    }).then(r => r.json()).then(j => {
      if(j.ok){
        msg.textContent = "✅ নিবন্ধন সফল! এখন প্রোফাইলে লগইন করুন।";
        msg.style.color = "#1b8c3a";
        name.value = ""; phone.value = ""; email.value = ""; pass.value = "";
      } else {
        msg.textContent = "❌ " + (j.error || "ব্যর্থ");
        msg.style.color = "#c1131d";
      }
    }).catch(err => {
      msg.textContent = "❌ সংযোগ ব্যর্থ";
      msg.style.color = "#c1131d";
    });
  };

  function renderFullBannerHtml(rows){
    return rows.map(b => {
      const link = b.link_url || "#";
      const target = /^https?:\/\//i.test(link) && !link.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : '';
      let style = '';
      if(b.width)  style += 'width:' + Number(b.width) + 'px;';
      if(b.height) style += 'height:' + Number(b.height) + 'px;';
      const dimAttr = style ? ' style="' + style + '"' : '';
      return '<a class="full-banner" href="' + esc(link) + '"' + target + ' data-pos="' + esc(b.position) + '">' +
        '<span class="full-banner-label"></span>' +
        '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || "ad") + '" loading="lazy"' + dimAttr + '>' +
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
