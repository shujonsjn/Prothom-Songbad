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
    })
    .catch(() => showError("সংবাদ লোড করা যায়নি"));

  function showError(msg){
    document.getElementById("title").innerText = msg;
    const img = document.getElementById("img");
    if(img) img.style.display = "none";
  }

})();
