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
  function toEmbedUrl(url) {
    if (!url) return null;
    if (/youtube\.com\/embed\//.test(url) || /player\.vimeo\.com\//.test(url)) return url;
    let m = url.match(/youtube\.com\/watch\?v=([\w-]{6,})/);
    if (m) return { type: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
    m = url.match(/youtu\.be\/([\w-]{6,})/);
    if (m) return { type: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return { type: "iframe", src: `https://player.vimeo.com/video/${m[1]}` };
    return { type: "video", src: url };
  }

  function renderVideo(url) {
    if (!url) return;
    const wrap = document.getElementById("videoWrap");
    const box  = document.getElementById("videoContainer");
    const e = toEmbedUrl(url);
    if (!e) return;
    if (e.type === "iframe") {
      const f = document.createElement("iframe");
      f.src = e.src;
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      f.allowFullscreen = true;
      f.setAttribute("frameborder", "0");
      box.appendChild(f);
    } else {
      const v = document.createElement("video");
      v.src = e.src;
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
