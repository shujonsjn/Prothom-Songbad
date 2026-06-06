/* ==========================================================
   NEWS.JS — Newspaper-style article (fetches by id from API)
   ========================================================== */

(function(){

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if(!id){
    showError("সংবাদ পাওয়া যায়নি");
    return;
  }

  let currentArticle = null;

  fetch("/api/news/" + encodeURIComponent(id))
    .then(r => {
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(n => {
      currentArticle = n;
      document.title = (n.title || "সংবাদ") + " — প্রথম সংবাদ";
      paintArticle(n);
      renderVideo(n.video);
      setShareLinks(n);
      loadRelated(n);
      loadTrending();
      trackView(id);
    })
    .catch(() => showError("সংবাদ লোড করা যায়নি"));

  /* ----- render article ----- */
  function paintArticle(n){
    const $ = id => document.getElementById(id);

    /* kicker: category in red */
    $("kicker").textContent = (n.category || "সর্বশেষ") + (n.subcategory ? "  ›  " + n.subcategory : "");

    /* headline */
    $("title").textContent = n.title || "শিরোনাম পাওয়া যায়নি";

    /* dek (subtitle) — first 140 chars of details or empty */
    const body = (n.details || "").trim();
    if(body.length > 80){
      const cut = body.slice(0, 160);
      const lastStop = Math.max(cut.lastIndexOf("।"), cut.lastIndexOf("."));
      $("dek").textContent = (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut) + "…";
    } else {
      $("dek").textContent = "";
    }

    /* image + caption (caption = category + time) */
    const img = $("img");
    if(n.image){
      img.src = n.image;
      img.alt = n.title || "";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      $("figure").style.display = "none";
    }
    $("caption").textContent = n.image ? ((n.category ? n.category + " — " : "") + "ছবি: সংগৃহীত") : "";

    /* byline */
    $("author").textContent = "নিজস্ব প্রতিবেদক";
    $("time").textContent   = "প্রকাশ: " + (n.time || "আজ");
    $("readTime").textContent = estimateReadTime(body) + " মিনিটে পড়া যাবে";

    /* body — paragraphs, pull quote, drop cap */
    $("detailsWrap").innerHTML = buildBodyHtml(body);

    /* tags from category + subcategory + extracted keywords */
    $("tagRow").innerHTML = buildTags(n);

    /* meta description */
    let meta = document.querySelector('meta[name="description"]');
    if(!meta){
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', (n.title || "") + " — প্রথম সংবাদ");
  }

  /* build the body HTML — drop cap on first paragraph, pull quote on 2nd long sentence,
     rest split into <p> by sentence boundaries */
  function buildBodyHtml(text){
    if(!text || !text.trim()){
      return '<p class="article-empty">বিস্তারিত পঠ্যক্ষণ চলছে…</p>';
    }
    /* normalize: ensure sentence-end punctuation, split into sentences */
    const normalized = text.replace(/\s+/g, " ").trim();
    const sentences = splitSentences(normalized);
    if(sentences.length === 0) return '<p>' + escHtml(normalized) + '</p>';

    const parts = [];
    /* lede — first paragraph with drop cap + bolded lead-in phrase (1st 2-3 words) */
    const firstCount = sentences.length >= 4 ? 3 : Math.max(1, sentences.length - 1);
    const firstChunk = sentences.slice(0, firstCount).join(" ");
    parts.push(`<p class="lede">${wrapFirstCharWithLead(escHtml(firstChunk))}</p>`);

    /* pull quote — first impactful sentence from middle of article */
    if(sentences.length >= 6){
      const idx = Math.min(4, sentences.length - 2);
      const pq = sentences[idx].trim();
      if(pq.length > 30 && pq.length < 220){
        parts.push(`<blockquote class="pull-quote">${escHtml(pq)}</blockquote>`);
      }
    }

    /* remaining sentences grouped into paragraphs of 2-3 */
    const rest = sentences.slice(firstCount);
    let buf = [];
    for(let i = 0; i < rest.length; i++){
      buf.push(rest[i]);
      if(buf.length >= 2 || i === rest.length - 1){
        parts.push(`<p>${escHtml(buf.join(" "))}</p>`);
        buf = [];
      }
    }
    return parts.join("\n");
  }

  function splitSentences(text){
    /* Bengali '।' + Latin '. ' etc. */
    return text
      .split(/(?<=[।!?])\s+|(?<=\.)\s+(?=[A-Z\u0981-\u09FF])/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function wrapFirstChar(html){
    /* wrap the first visible character in a <span class="dropcap"> */
    if(!html) return "";
    return html.replace(/^(\s*)([^\s<])/, (m, sp, ch) => `${sp}<span class="dropcap">${ch}</span>`);
  }

  /* wraps the first character as dropcap, and the next 2-3 words as bolded lead-in.
     Dropcap takes the FIRST char; the rest of the first word is preserved.
     Lead-in covers the first 2-3 words including the rest of the first word. */
  function wrapFirstCharWithLead(html){
    if(!html) return "";
    /* find first char boundary */
    const m = html.match(/^(\s*)(\S)([\s\S]*)$/);
    if(!m) return html;
    const lead  = m[1];        // leading whitespace
    const first = m[2];        // first character
    const rest  = m[3];        // everything else
    /* take the first 2-3 words from `rest` to bold */
    const wordMatch = rest.match(/^([^\s]+(?:\s+[^\s]+){0,2})([\s\S]*)$/);
    if(!wordMatch) return `${lead}<span class="dropcap">${first}</span>${rest}`;
    const leadPhrase = wordMatch[1];
    const tail       = wordMatch[2];
    return `${lead}<span class="dropcap">${first}</span><span class="lede-lead">${leadPhrase}</span>${tail}`;
  }

  function buildTags(n){
    const tags = [];
    if(n.category)    tags.push(n.category);
    if(n.subcategory) tags.push(n.subcategory);
    /* generate a slug tag from a few words in the title */
    if(n.title){
      const t = n.title.split(/[\s।,]+/).filter(w => w.length > 3).slice(0, 2);
      t.forEach(w => tags.push("#" + w));
    }
    if(!tags.length) return "";
    return tags.map(t => `<a class="tag-chip" href="/index.html?cat=${encodeURIComponent(n.category || '')}">${escHtml(t)}</a>`).join("");
  }

  function estimateReadTime(text){
    const words = (text || "").trim().split(/\s+/).length;
    const mins = Math.max(1, Math.round(words / 180));
    return mins;
  }

  /* ----- share links ----- */
  function setShareLinks(n){
    const url = encodeURIComponent(window.location.href);
    const txt = encodeURIComponent(n.title || "প্রথম সংবাদ");
    document.getElementById("shareFb").href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    document.getElementById("shareX").href  = `https://twitter.com/intent/tweet?url=${url}&text=${txt}`;
    document.getElementById("shareWa").href = `https://wa.me/?text=${txt}%20${url}`;
    document.getElementById("shareCopy").addEventListener("click", () => {
      navigator.clipboard?.writeText(window.location.href);
      const btn = document.getElementById("shareCopy");
      const orig = btn.querySelector("span").textContent;
      btn.querySelector("span").textContent = "কপি হয়েছে ✓";
      setTimeout(() => { btn.querySelector("span").textContent = orig; }, 1500);
    });
  }

  /* ----- related stories (same category, exclude self) ----- */
  async function loadRelated(n){
    const box = document.getElementById("relatedList");
    try {
      const r = await fetch("/api/news?category=" + encodeURIComponent(n.category || "") + "&limit=4");
      if(!r.ok) throw 0;
      const list = await r.json();
      const filtered = (Array.isArray(list) ? list : []).filter(x => String(x.id) !== String(n.id)).slice(0, 4);
      if(!filtered.length){ box.innerHTML = '<p class="aside-empty">আর কোনো খবর নেই</p>'; return; }
      box.innerHTML = filtered.map(x => `
        <a class="related-item" href="/news.html?id=${x.id}">
          <div class="related-thumb"><img src="${escAttr(x.image || '')}" alt="" loading="lazy"></div>
          <div class="related-body">
            <div class="related-cat">${escHtml(x.subcategory || x.category || "")}</div>
            <div class="related-title">${escHtml(x.title || "")}</div>
            <div class="related-meta">${escHtml(x.time || "")}</div>
          </div>
        </a>`).join("");
    } catch { box.innerHTML = ''; }
  }

  /* ----- trending from sidebar API ----- */
  async function loadTrending(){
    const box = document.getElementById("trendingList");
    try {
      const r = await fetch("/api/news?limit=5");
      if(!r.ok) throw 0;
      const list = await r.json();
      if(!Array.isArray(list) || !list.length){ box.innerHTML = ''; return; }
      box.innerHTML = list.slice(0, 5).map((x, i) => `
        <li>
          <a href="/news.html?id=${x.id}">
            <span class="trending-num">${i + 1}</span>
            <span class="trending-title">${escHtml(x.title || "")}</span>
          </a>
        </li>`).join("");
    } catch { box.innerHTML = ''; }
  }

  /* ----- video rendering (unchanged from original) ----- */
  function toEmbedInfo(url){
    if(!url) return null;
    if(/youtube\.com\/embed\//.test(url) || /player\.vimeo\.com\//.test(url)){
      return { type:"iframe", src:url };
    }
    let m = url.match(/youtube\.com\/watch\?v=([\w-]{6,})/);
    if(m) return { type:"youtube", id:m[1] };
    m = url.match(/youtu\.be\/([\w-]{6,})/);
    if(m) return { type:"youtube", id:m[1] };
    m = url.match(/vimeo\.com\/(\d+)/);
    if(m) return { type:"vimeo", id:m[1] };
    return { type:"video", src:url };
  }

  function renderVideo(url){
    if(!url) return;
    const img = document.getElementById("img");
    if(img) img.style.display = "none";
    const wrap = document.getElementById("videoWrap");
    const box  = document.getElementById("videoContainer");
    const info = toEmbedInfo(url);
    if(!info) return;

    if(info.type === "youtube" || (info.type === "iframe" && /youtube\.com\/embed\//.test(info.src || url))){
      const vid = info.id || (info.src && (info.src.match(/youtube\.com\/embed\/([\w-]{6,})/) || [])[1]);
      const placeholder = document.createElement("div");
      placeholder.className = "yt-placeholder";
      placeholder.setAttribute("data-vid", vid);
      placeholder.style.backgroundImage = `url("https://i.ytimg.com/vi/${vid}/maxresdefault.jpg"), url("https://i.ytimg.com/vi/${vid}/hqdefault.jpg")`;
      placeholder.innerHTML = `
        <button class="yt-play" type="button" aria-label="ভিডিও চালু করুন">
          <svg viewBox="0 0 68 48" width="68" height="48">
            <path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#f00" fill-opacity="0.85"/>
            <path d="M45 24 27 14v20" fill="#fff"/>
          </svg>
        </button>
        <div class="yt-credit">YouTube</div>`;
      placeholder.addEventListener("click", () => {
        const iframe = document.createElement("iframe");
        iframe.src = `https://www.youtube.com/embed/${vid}?autoplay=1&rel=0`;
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.setAttribute("frameborder", "0");
        iframe.title = "YouTube video player";
        placeholder.replaceWith(iframe);
      }, { once: true });
      box.appendChild(placeholder);
    } else if(info.type === "vimeo" || (info.type === "iframe" && /player\.vimeo\.com/.test(info.src || url))){
      const vid = info.id || (info.src && (info.src.match(/vimeo\.com\/video\/(\d+)/) || [])[1]);
      const iframe = document.createElement("iframe");
      iframe.src = `https://player.vimeo.com/video/${vid}?autoplay=1`;
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.setAttribute("frameborder", "0");
      iframe.title = "Vimeo video player";
      box.appendChild(iframe);
    } else if(info.type === "iframe"){
      const iframe = document.createElement("iframe");
      iframe.src = info.src;
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.setAttribute("frameborder", "0");
      iframe.title = "Video player";
      box.appendChild(iframe);
    } else {
      const v = document.createElement("video");
      v.src = info.src;
      v.controls = true;
      v.preload = "metadata";
      v.style.width = "100%";
      box.appendChild(v);
    }
    wrap.hidden = false;
  }

  /* ----- helpers ----- */
  function escHtml(s){
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escAttr(s){ return escHtml(s); }

  function trackView(newsId){
    try {
      const body = JSON.stringify({
        newsId: Number(newsId) || null,
        path:   "/news.html?id=" + newsId
      });
      if(navigator.sendBeacon){
        navigator.sendBeacon("/api/track-view", new Blob([body], { type:"application/json" }));
      } else {
        fetch("/api/track-view", { method:"POST", headers:{ "Content-Type":"application/json" }, body, keepalive:true }).catch(()=>{});
      }
    } catch {}
  }

  function showError(msg){
    document.getElementById("title").textContent = msg;
    document.getElementById("dek").textContent = "";
    document.getElementById("byline").style.display = "none";
    document.getElementById("figure").style.display = "none";
    document.getElementById("detailsWrap").innerHTML = "";
    document.getElementById("tagRow").innerHTML = "";
    document.getElementById("shareRow").style.display = "none";
  }

})();
