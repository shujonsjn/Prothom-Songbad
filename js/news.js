/* ==========================================================
   NEWS.JS — News detail page (fetches by id from API)
   ========================================================== */

(function(){

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if(!id){
    showError("সংবাদ পাওয়া যায়নি");
    return;
  }

  fetch("/api/news/" + encodeURIComponent(id))
    .then(r => {
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(n => {
      document.getElementById("img").src     = n.image   || "";
      document.getElementById("title").innerText  = n.title   || "";
      document.getElementById("details").innerText = n.details || "";
      document.getElementById("meta").innerText   = "প্রকাশ: " + (n.time || "আজ");
      renderVideo(n.video);
    })
    .catch(() => showError("সংবাদ লোড করা যায়নি"));

  /* YouTube/Vimeo URL → embed URL; raw .mp4/.m3u8 → সরাসরি <video> */
  function toEmbedInfo(url) {
    if (!url) return null;
    if (/youtube\.com\/embed\//.test(url) || /player\.vimeo\.com\//.test(url)) {
      return { type: "iframe", src: url };
    }
    let m = url.match(/youtube\.com\/watch\?v=([\w-]{6,})/);
    if (m) return { type: "youtube", id: m[1] };
    m = url.match(/youtu\.be\/([\w-]{6,})/);
    if (m) return { type: "youtube", id: m[1] };
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return { type: "vimeo", id: m[1] };
    return { type: "video", src: url };
  }

  function renderVideo(url) {
    if (!url) return;
    const wrap = document.getElementById("videoWrap");
    const box  = document.getElementById("videoContainer");
    const info = toEmbedInfo(url);
    if (!info) return;

    if (info.type === "youtube") {
      /* Lazy-load pattern — Prothom Alo-এর মতো: প্রথমে poster + play বাটন,
         ক্লিক করলে iframe বসবে (তাই initial load দ্রুত হয়)। */
      const vid = info.id;
      const poster = document.getElementById("img");
      const posterSrc = poster && poster.src ? poster.src : "";
      const placeholder = document.createElement("div");
      placeholder.className = "yt-placeholder";
      placeholder.setAttribute("data-vid", vid);
      if (posterSrc) {
        placeholder.style.backgroundImage = `url("${posterSrc}")`;
      }
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
    } else if (info.type === "vimeo") {
      const iframe = document.createElement("iframe");
      iframe.src = `https://player.vimeo.com/video/${info.id}?autoplay=1`;
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.setAttribute("frameborder", "0");
      iframe.title = "Vimeo video player";
      box.appendChild(iframe);
    } else {
      const v = document.createElement("video");
      v.src = info.src;
      v.controls = true;
      v.preload  = "metadata";
      v.style.width = "100%";
      box.appendChild(v);
    }
    wrap.hidden = false;
  }

  function showError(msg){
    document.getElementById("title").innerText = msg;
    const img = document.getElementById("img");
    if(img) img.style.display = "none";
  }

})();
