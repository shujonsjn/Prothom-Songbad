/* ==========================================================
   SUBCATEGORIES.JS — Dynamic sub-category loader for the
   mega menu. Fetches from /api/subcategories; if that fails
   (or DB is empty), falls back to the hardcoded defaults.
   Exposes window.SUBCATEGORIES as { "MainCat": ["sub1", ...] }
   so js/nav.js can render the mega menu without changes.
   ========================================================== */

(function(){
  /* Hardcoded fallback (used only if /api/subcategories fails) */
  const FALLBACK = {
    "খেলা": [
      "ক্রিকেট", "ফুটবল", "টেনিস", "জানা খেলা", "সাফখেলাস",
      "সড়ক দৌড়", "কুইব", "সাত রং", "ভিডিও", "আর্কাইভ খেলা"
    ],
    "জাতীয়": [
      "রাজনীতি", "সরকার", "সংসদ", "আইন-আদালত", "অপরাধ",
      "শিক্ষা", "স্বাস্থ্য", "পরিবেশ"
    ],
    "আন্তর্জাতিক": [
      "এশিয়া", "ইউরোপ", "আমেরিকা", "মধ্যপ্রাচ্য", "আফ্রিকা", "ওশেনিয়া"
    ],
    "বিনোদন": [
      "চলচ্চিত্র", "গান", "নাটক", "সিরিজ", "টেলিভিশন",
      "বলিউড", "হলিউড", "দক্ষিণী", "কোরীয়"
    ],
    "Binodon": [
      "চলচ্চিত্র", "গান", "নাটক", "সিরিজ", "টেলিভিশন",
      "বলিউড", "হলিউড", "দক্ষিণী", "কোরীয়"
    ],
    "প্রযুক্তি": [
      "মোবাইল", "কম্পিউটার", "সফটওয়্যার", "গেমস", "ইন্টারনেট", "এআই"
    ]
  };

  /* Prothom Alo URL slug → sub-category mapping, used by cron */
  window.URL_TO_SUBCAT = {
    cricket:    "ক্রিকেট",
    football:   "ফুটবল",
    tennis:     "টেনিস",
    hockey:     "হকি",
    badminton:  "ব্যাডমিন্টন",
    kabaddi:    "কাবাডি",
    golf:       "গলফ",
    chess:      "দাবা",
    archery:    "তীরন্দাজি",
    athletics:  "অ্যাথলেটিক্স",
    swimming:   "সাঁতার",
    boxing:     "বক্সিং",
    esports:    "ই-স্পোর্টস"
  };

  /* nav.js subscribes to this event once data is ready */
  function publish(map){
    window.SUBCATEGORIES = map;
    window.dispatchEvent(new CustomEvent("subcategories:ready", { detail: map }));
  }

  /* Immediate fallback so nav.js has data synchronously */
  publish(FALLBACK);

  /* Then asynchronously try API; if it returns a different/richer
     list, republish so the mega menu re-renders. */
  fetch("/api/subcategories")
    .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    .then(rows => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const map = {};
      for (const r of rows) {
        if (!r.category || !r.name) continue;
        if (!map[r.category]) map[r.category] = [];
        if (!map[r.category].includes(r.name)) map[r.category].push(r.name);
      }
      if (Object.keys(map).length > 0) publish(map);
    })
    .catch(() => { /* keep fallback */ });
})();
