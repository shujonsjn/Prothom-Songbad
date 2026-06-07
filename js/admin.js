/* ==========================================================
   ADMIN.JS — Admin panel (API + HTTP Basic Auth)
   ========================================================== */

(function(){

  let credentials = null;   // { u, p }
  let editId      = null;   // currently edited news id
  let categoriesCache = [];
  let subCatsCache    = [];
  let newsCache       = [];
  let _filters        = { cat: "", sub: "", q: "" };

  /* native alert() override → use toast if available, fallback to alert */
  const _origAlert = window.alert.bind(window);
  window.alert = function(msg){
    if(typeof toast === "function"){
      toast(String(msg), "err");
    } else {
      _origAlert(msg);
    }
  };

  const loginBox = document.getElementById("loginBox");
  const admin    = document.getElementById("admin");
  const u        = document.getElementById("u");
  const p        = document.getElementById("p");
  const title    = document.getElementById("title");
  const category = document.getElementById("category");
  const subcat   = document.getElementById("subcategory");
  const details  = document.getElementById("details");
  const img      = document.getElementById("img");
  const list     = document.getElementById("list");
  const catList  = document.getElementById("catList");
  const newCat   = document.getElementById("newCat");
  const addSubInline = document.getElementById("addSubInline");

  function authHeader(){
    return { "Authorization": "Basic " + btoa(credentials.u + ":" + credentials.p) };
  }

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }

  /* ===== LOGIN ===== */
  window.login = function(){
    if(!u.value || !p.value){
      alert("Username এবং Password দিন");
      return;
    }
    credentials = { u: u.value, p: p.value };

    fetch("/api/admin/check", { headers: authHeader() })
      .then(r => {
        if(r.status === 401) throw new Error("Invalid credentials");
        if(!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(() => {
        loginBox.style.display = "none";
        admin.style.display    = "block";
        load();
        setTimeout(() => { try { loadDashboard(); } catch(e){ console.warn("dashboard:", e); } }, 50);
        setTimeout(() => { try { loadProfile(); } catch(e){ console.warn("profile:", e); } }, 200);
        setTimeout(() => { try { loadInbox(); } catch(e){ console.warn("inbox:", e); } }, 400);
        /* periodic inbox count refresh (every 30s) */
        if(!window._inboxPoll){
          window._inboxPoll = setInterval(() => {
            if(admin && admin.style.display !== "none"){
              fetch("/api/inbox", { headers: authHeader() })
                .then(r => r.ok ? r.json() : null)
                .then(j => {
                  if(!j || !j.counts) return;
                  const c = j.counts;
                  const cnt = document.getElementById("cntInbox");
                  if(cnt){
                    const u = c.unread || 0;
                    cnt.style.display = u > 0 ? "" : "none";
                    cnt.textContent = u > 99 ? "99+" : String(u);
                  }
                  /* if user is on inbox section, refresh list too */
                  const onInbox = document.querySelector('[data-section="inbox"]')?.classList.contains("active") ||
                                  document.querySelector('.admin-section[data-section="inbox"]')?.style.display !== "none";
                  if(onInbox && j.messages) _inboxMessages = j.messages, renderInboxList();
                })
                .catch(() => {});
            }
          }, 30000);
        }
      })
      .catch(err => {
        alert("Login failed: " + err.message);
        credentials = null;
        u.value = "";
        p.value = "";
      });
  };

  /* ===== LOGOUT ===== */
  window.logout = function(){
    credentials = null;
    editId = null;
    clear();
    admin.style.display    = "none";
    loginBox.style.display = "flex";
    u.value = "";
    p.value = "";
  };

  /* ===== SIDEBAR MENU / SECTION SWITCHING ===== */
  const sbLinks     = document.querySelectorAll(".sb-link[data-section]");
  const sbSections  = document.querySelectorAll(".admin-section[data-section]");
  const cntPostsEl  = document.getElementById("cntPosts");
  const cntCatsEl   = document.getElementById("cntCats");
  const cntSubsEl   = document.getElementById("cntSubs");

  function showSection(name){
    sbLinks.forEach(a => a.classList.toggle("active", a.getAttribute("data-section") === name));
    sbSections.forEach(s => s.classList.toggle("active", s.getAttribute("data-section") === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  sbLinks.forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const name = a.getAttribute("data-section");
      if (name) {
        showSection(name);
        if (name === "dashboard") loadDashboard();
      }
    });
  });

  /* ===== DASHBOARD ===== */
  let _dashRange = "24h";
  let _chartViews = null;
  let _chartCategory = null;
  function fmtNum(n){
    n = Number(n) || 0;
    if (n >= 1000) return (n/1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }
  function rangeLabel(r){
    return ({ "24h":"Last 24h", "7d":"Last 7 days", "30d":"Last 30 days", "all":"All time" })[r] || r;
  }
  document.querySelectorAll(".range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _dashRange = btn.getAttribute("data-range");
      loadDashboard();
    });
  });

  function loadDashboard(){
    if (typeof Chart === "undefined") return;
    const rangeLbl = document.getElementById("dashRangeLabel");
    if (rangeLbl) rangeLbl.textContent = rangeLabel(_dashRange);

    fetch("/api/analytics?range=" + encodeURIComponent(_dashRange), { headers: authHeader() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(data => {
        /* stat values */
        const map = data.totals || {};
        document.querySelectorAll("[data-k]").forEach(el => {
          const k = el.getAttribute("data-k");
          el.textContent = fmtNum(map[k]);
        });

        /* Views over time chart */
        const vc = document.getElementById("chartViews");
        if (vc) {
          const labels = (data.viewsByDay || []).map(r => r.bucket);
          const values = (data.viewsByDay || []).map(r => r.c);
          const labelsP = (data.postsByDay || []).map(r => r.bucket);
          const valuesP = (data.postsByDay || []).map(r => r.c);
          const postsByBucket = {};
          labelsP.forEach((b, i) => postsByBucket[b] = valuesP[i]);

          if (_chartViews) _chartViews.destroy();
          _chartViews = new Chart(vc.getContext("2d"), {
            type: "line",
            data: {
              labels: labels,
              datasets: [
                {
                  label: "Views",
                  data: values,
                  borderColor: "#6750a4",
                  backgroundColor: "rgba(103,80,164,.12)",
                  borderWidth: 2.5,
                  tension: .35,
                  fill: true,
                  pointRadius: 3,
                  pointHoverRadius: 6,
                  pointBackgroundColor: "#6750a4"
                },
                {
                  label: "Posts",
                  data: labels.map(b => postsByBucket[b] || 0),
                  borderColor: "#b3261e",
                  backgroundColor: "rgba(179,38,30,.10)",
                  borderWidth: 2,
                  tension: .3,
                  fill: false,
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  pointBackgroundColor: "#b3261e"
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: "index", intersect: false },
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { backgroundColor: "#322f35", titleFont:{ size:12 }, bodyFont:{ size:12 } }
              },
              scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: "rgba(0,0,0,.05)" } }
              }
            }
          });
        }

        /* Category donut */
        const cc = document.getElementById("chartCategory");
        if (cc) {
          const cats = (data.byCategory || []).filter(c => c.posts > 0);
          const palette = ["#b3261e","#6750a4","#0058a3","#1b5e20","#7c3a00","#7d5260","#1a237e","#00695c","#ad1457","#283593"];
          if (_chartCategory) _chartCategory.destroy();
          _chartCategory = new Chart(cc.getContext("2d"), {
            type: "doughnut",
            data: {
              labels: cats.map(c => c.category),
              datasets: [{
                data: cats.map(c => c.posts),
                backgroundColor: cats.map((_, i) => palette[i % palette.length]),
                borderColor: "#fff",
                borderWidth: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: "62%",
              plugins: {
                legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { backgroundColor: "#322f35" }
              }
            }
          });
        }

        /* Top viewed list */
        const top = document.getElementById("rankTop");
        if (top) {
          const rows = data.topNews || [];
          if (rows.length === 0) {
            top.innerHTML = '<li class="empty-state">এই সময়ে কোনো view নেই</li>';
          } else {
            top.innerHTML = rows.map((r, i) => {
              const rankCls = i < 3 ? " top-" + (i+1) : "";
              return '<li>' +
                '<span class="rank-num' + rankCls + '">' + (i+1) + '</span>' +
                '<div class="rank-text">' + esc(r.title) +
                  '<small>' + esc(r.category || "—") + (r.subcategory ? " › " + esc(r.subcategory) : "") + '</small>' +
                '</div>' +
                '<span class="rank-views"><span class="ms">visibility</span> ' + fmtNum(r.views) + '</span>' +
              '</li>';
            }).join("");
          }
        }

        /* Recent activity list */
        const rec = document.getElementById("rankRecent");
        if (rec) {
          const rows = data.recent || [];
          if (rows.length === 0) {
            rec.innerHTML = '<li class="empty-state">এই সময়ে নতুন পোস্ট নেই</li>';
          } else {
            rec.innerHTML = rows.map((r, i) => {
              const rankCls = i < 3 ? " top-" + (i+1) : "";
              return '<li>' +
                '<span class="rank-num' + rankCls + '"><span class="ms">article</span></span>' +
                '<div class="rank-text">' + esc(r.title) +
                  '<small>' + esc(r.category || "—") + ' · ' + esc((r.created_at || "").slice(0,16)) + '</small>' +
                '</div>' +
              '</li>';
            }).join("");
          }
        }
      })
      .catch(err => console.error("Dashboard load failed:", err));
  }

  function refreshSidebarCounts(){
    if(cntPostsEl) cntPostsEl.textContent = (list && list.children.length) || 0;
    if(cntCatsEl)  cntCatsEl.textContent  = categoriesCache.length || 0;
    if(cntSubsEl)  cntSubsEl.textContent  = (subCatsCache || []).length || 0;
  }

  /* ===== M3 SNACKBAR ===== */
  function toast(msg, type = "ok", ms = 2800){
    const old = document.querySelector(".snack.show");
    if(old){ old.classList.remove("show"); setTimeout(() => old.remove(), 250); }
    const t = document.createElement("div");
    t.className = "snack " + type;
    const icons = { ok: "✓", err: "✕", warn: "!" };
    t.innerHTML = `<span class="snack-icon">${icons[type] || "•"}</span><span class="snack-msg">${msg}</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 320);
    }, ms);
  }

  /* sidebar-এ logged-in user name দেখাই */
  const sbUserNameEl = document.getElementById("sbUserName");
  const sbAvatarEl   = document.querySelector(".sb-avatar");
  function setSidebarUser(name){
    if(sbUserNameEl) sbUserNameEl.textContent = name || "admin";
    if(sbAvatarEl)   sbAvatarEl.textContent   = (name || "A").charAt(0).toUpperCase();
  }
  setSidebarUser("admin");

  /* ===== SAVE / PUBLISH (create or update) ===== */
  window.save = function(){
    if(!title.value || !category.value || !details.value){
      toast("Title, Category, Details সবগুলো দিতে হবে", "warn");
      return;
    }

    const isEdit = editId !== null;
    if(!isEdit && !img.files[0] && !document.getElementById("imageUrl").value){
      toast("Image required", "warn");
      return;
    }

    const form = new FormData();
    form.append("title",    title.value);
    form.append("category", category.value);
    form.append("details",  details.value);
    const imageUrlEl = document.getElementById("imageUrl");
    const videoEl    = document.getElementById("video");
    const subcatEl   = document.getElementById("subcategory");
    if(imageUrlEl && imageUrlEl.value) form.append("imageUrl", imageUrlEl.value);
    if(videoEl    && videoEl.value)    form.append("video",    videoEl.value);
    if(subcatEl   && subcatEl.value)   form.append("subcategory", subcatEl.value);
    if(img.files[0]) form.append("image", img.files[0]);
    if(isEdit) form.append("keepImage", "1");

    const url    = isEdit ? "/api/news/" + editId : "/api/news";
    const method = isEdit ? "PUT" : "POST";

    fetch(url, { method, headers: authHeader(), body: form })
      .then(r => {
        if(r.status === 401){ toast("Session expired. Please login again.", "err"); logout(); return null; }
        if(!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(saved => {
        if(!saved) return;
        toast(isEdit ? "✓ আপডেট হয়েছে" : "✓ প্রকাশিত হয়েছে", "ok");
        clear();
        load();
      })
      .catch(err => toast("Save failed: " + err.message, "err"));
  };

  /* ===== LOAD LIST ===== */
  function load(){
    fetch("/api/news", { headers: authHeader() })
      .then(r => {
        if(r.status === 401){ logout(); return null; }
        return r.json();
      })
      .then(rows => {
        if(!rows) return;
        newsCache = rows;
        renderFiltered();
        refreshSidebarCounts();
      })
      .catch(err => alert("Load failed: " + err.message));

    loadCategories();
    loadSubCategories();
  }

  /* ===== LOAD CATEGORIES ===== */
  function loadCategories(){
    fetch("/api/categories", { headers: authHeader() })
      .then(r => {
        if(r.status === 401){ logout(); return null; }
        return r.json();
      })
      .then(rows => {
        if(!rows) return;
        categoriesCache = rows || [];
        renderCategorySelect();
        renderCategoryList();
        if(typeof renderSubCatParent === "function") renderSubCatParent();
        /* category select refresh হলে form-এর sub-dropdown আপডেট করি */
        if(typeof renderSubcategorySelect === "function") renderSubcategorySelect();
        refreshSidebarCounts();
      })
      .catch(err => console.error("Category load failed:", err));
  }

  function renderCategorySelect(){
    const prev = category.value;
    category.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = " ";
    placeholder.disabled = true;
    if(!prev) placeholder.selected = true;
    category.appendChild(placeholder);
    if(categoriesCache.length === 0){
      const opt = document.createElement("option");
      opt.textContent = "— কোনো ক্যাটাগরি নেই —";
      opt.disabled = true;
      category.appendChild(opt);
      return;
    }
    categoriesCache.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.category;
      opt.textContent = `${c.category} (${c.count})`;
      category.appendChild(opt);
    });
    if(prev && categoriesCache.some(c => c.category === prev)){
      category.value = prev;
    }
  }

  function renderCategoryList(){
    if(categoriesCache.length === 0){
      catList.innerHTML = `<div class="empty" style="font-size:14px;padding:20px;">কোনো ক্যাটাগরি নেই</div>`;
      return;
    }
    catList.innerHTML = "";
    categoriesCache.forEach(c => {
      const row = document.createElement("div");
      row.className = "cat-item";
      row.draggable = true;
      row.dataset.name = c.category;
      row.innerHTML = `
        <span class="cat-drag" title="ধরে টেনে উপরে-নিচে সাজান"><span class="ms">drag_indicator</span></span>
        <div class="cat-info">
          <b>${esc(c.category)}</b>
          <small>${c.count}টি সংবাদ${c.hidden ? ' · <span style="color:#c1131d;">লুকানো</span>' : ''}</small>
        </div>
        <div class="actions">
          <button class="small-btn" data-name="${esc(c.category)}" data-action="toggle" title="Hide/Show on public site">${c.hidden ? 'Show' : 'Hide'}</button>
          <button class="small-btn" data-name="${esc(c.category)}" data-action="del">Delete</button>
        </div>`;
      catList.appendChild(row);
    });
    catList.querySelectorAll('button[data-action="del"]').forEach(btn => {
      btn.addEventListener("click", () => deleteCategory(btn.dataset.name));
    });
    catList.querySelectorAll('button[data-action="toggle"]').forEach(btn => {
      btn.addEventListener("click", () => toggleCategoryHidden(btn.dataset.name));
    });
    /* drag & drop reordering */
    let dragSrc = null;
    let saveTimer = null;
    catList.querySelectorAll('.cat-item').forEach(row => {
      row.addEventListener("dragstart", (e) => {
        dragSrc = row;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", row.dataset.name); } catch {}
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        catList.querySelectorAll('.cat-item').forEach(r => r.classList.remove("drag-over"));
        /* debounced save */
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCategoryOrder, 600);
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if(!dragSrc || dragSrc === row) return;
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        if(after) row.parentNode.insertBefore(dragSrc, row.nextSibling);
        else      row.parentNode.insertBefore(dragSrc, row);
        catList.querySelectorAll('.cat-item').forEach(r => r.classList.remove("drag-over"));
        row.classList.add("drag-over");
      });
    });
  }

  function saveCategoryOrder(){
    const rows = Array.from(catList.querySelectorAll('.cat-item'));
    const order = rows.map((r, i) => ({ name: r.dataset.name, sort_order: i }));
    /* also update local cache so public site gets the new order on next fetch */
    categoriesCache.forEach(c => {
      const found = order.find(o => o.name === c.category);
      if(found) c.sort_order = found.sort_order;
    });
    fetch("/api/categories/reorder", {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ order })
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(() => toast("Category order saved ✓"))
      .catch(err => toast("Order save failed: " + err.message, "error"));
  }

  window.toggleCategoryHidden = function(name){
    const c = categoriesCache.find(x => x.category === name);
    if(!c) return;
    const newHidden = !c.hidden;
    fetch("/api/categories/" + encodeURIComponent(name) + "/hidden", {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: newHidden })
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(() => {
        c.hidden = newHidden ? 1 : 0;
        renderCategoryList();
        toast(newHidden ? "লুকানো হয়েছে (public site থেকে সরানো)" : "দেখাচ্ছে");
      })
      .catch(err => toast("Toggle failed: " + err.message, "error"));
  };

  /* ===== ADD CATEGORY ===== */
  window.addCategory = function(){
    const name = (newCat.value || "").trim();
    if(!name){
      alert("ক্যাটাগরির নাম দিন");
      return;
    }
    fetch("/api/categories", {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if(r.status === 401){ alert("Session expired."); logout(); return null; }
        if(!r.ok) throw new Error(data.error || "HTTP " + r.status);
        return data;
      })
      .then(res => {
        if(!res) return;
        newCat.value = "";
        loadCategories();
        load();
      })
      .catch(err => alert("Add failed: " + err.message));
  };

  /* ===== DELETE CATEGORY ===== */
  function deleteCategory(name){
    if(!confirm(`“${name}” ক্যাটাগরি মুছে ফেলতে চান?`)) return;
    fetch("/api/categories/" + encodeURIComponent(name), {
      method: "DELETE",
      headers: authHeader()
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if(r.status === 401){ alert("Session expired."); logout(); return null; }
        if(!r.ok) throw new Error(data.error || "HTTP " + r.status);
        return data;
      })
      .then(res => {
        if(!res) return;
        loadCategories();
        load();
      })
      .catch(err => alert("Delete failed: " + err.message));
  }

  /* ===== SUB-CATEGORY MANAGER ===== */
  const subCatParent = document.getElementById("subCatParent");
  const subCatName   = document.getElementById("subCatName");
  const subCatList   = document.getElementById("subCatList");

  function loadSubCategories(){
    fetch("/api/subcategories", { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        subCatsCache = rows || [];
        renderSubCatParent();
        renderSubCatList();
        renderSubcategorySelect(); /* form-এর dropdown আপডেট */
        refreshSidebarCounts();
      })
      .catch(() => {
        if(subCatList) subCatList.innerHTML = `<div class="empty" style="font-size:14px;padding:20px;">লোড করা যাচ্ছে না</div>`;
      });
  }

  /* ===== FORM-এর SUB-CATEGORY DROPDOWN ===== */
  function renderSubcategorySelect(){
    if(!subcat) return;
    const prev    = subcat.value;
    const parent  = category.value || "";
    subcat.innerHTML = "";

    /* placeholder (empty text — label acts as visible placeholder) */
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = " ";
    ph.disabled = true;
    if(!prev) ph.selected = true;
    subcat.appendChild(ph);

    if(!parent) return;

    const matching = (subCatsCache || []).filter(s => s.category === parent);
    for (const s of matching) {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name + (s.newsCount ? ` (${s.newsCount})` : "");
      subcat.appendChild(opt);
    }
    /* যদি পুরনো subcategory cache-এ না থাকে (যেমন মুছে ফেলা হয়েছে),
       তাও dropdown-এ দেখাই — যাতে edit করার সময় context হারায় না */
    if(prev && !matching.some(s => s.name === prev)){
      const opt = document.createElement("option");
      opt.value = prev;
      opt.textContent = prev + " (মুছে ফেলা)";
      opt.style.color = "#888";
      subcat.appendChild(opt);
    }
    if(prev){
      subcat.value = prev;
    }
  }

  /* category বদলালে sub-dropdown refresh হবে */
  if(category){
    category.addEventListener("change", renderSubcategorySelect);
  }

  /* "+ নতুন sub" button — prompt এ নাম নিয়ে inline add */
  if(addSubInline){
    addSubInline.addEventListener("click", async () => {
      const parent = (category && category.value) || "";
      if(!parent){ alert("আগে main category বাছাই করুন"); return; }
      const name = (prompt(`“${parent}” category-তে নতুন sub-category এর নাম:`) || "").trim();
      if(!name) return;
      try {
        const r = await fetch("/api/subcategories", {
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ category: parent, name })
        });
        const data = await r.json().catch(() => ({}));
        if(r.status === 401){ alert("Session expired."); logout(); return; }
        if(!r.ok){ alert(data.error || "Add failed"); return; }
        await loadSubCategories();
        if(subcat) subcat.value = name;
      } catch (e) {
        alert("Add failed: " + e.message);
      }
    });
  }

  function renderSubCatParent(){
    if(!subCatParent) return;
    const prev = subCatParent.value;
    subCatParent.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = " ";
    placeholder.disabled = true;
    if(!prev) placeholder.selected = true;
    subCatParent.appendChild(placeholder);
    const seen = new Set();
    for (const c of categoriesCache) {
      if (!c.category || seen.has(c.category)) continue;
      seen.add(c.category);
      const opt = document.createElement("option");
      opt.value = c.category;
      opt.textContent = c.category;
      subCatParent.appendChild(opt);
    }
    if(prev && seen.has(prev)) subCatParent.value = prev;
  }

  function renderSubCatList(){
    if(!subCatList) return;
    subCatList.innerHTML = "";

    /* parent category অনুযায়ী group — সব parent দেখাই, এমনকি sub-category না থাকলেও */
    const grouped = {};
    for (const c of categoriesCache) {
      grouped[c.category] = [];
    }
    for (const s of subCatsCache) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push(s);
    }

    const palette = [
      { bg:"#f9dedc", fg:"#b3261e" },
      { bg:"#e8def8", fg:"#6750a4" },
      { bg:"#cce8ff", fg:"#0058a3" },
      { bg:"#d8f5e3", fg:"#1b5e20" },
      { bg:"#fde7c4", fg:"#7c3a00" },
      { bg:"#ffd8e4", fg:"#7d5260" },
      { bg:"#d8e6ff", fg:"#1a237e" }
    ];
    let pi = 0;
    /* sort by categoriesCache order (sort_order) */
    for (const c of categoriesCache) {
      const cat = c.category;
      const color = palette[pi++ % palette.length];
      const items = grouped[cat] || [];
      const block = document.createElement("div");
      block.className = "subcat-group";
      block.style.setProperty("--sc-bg", color.bg);
      block.style.setProperty("--sc-fg", color.fg);

      const head = document.createElement("div");
      head.className = "subcat-head";
      head.innerHTML = '<div class="subcat-head-left"><span class="subcat-icon"><span class="ms">folder</span></span><span class="subcat-name">' + esc(cat) + '</span></div><span class="subcat-count">' + items.length + '</span>';
      block.appendChild(head);

      const chips = document.createElement("div");
      chips.className = "subcat-chips";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "subcat-empty";
        empty.textContent = "কোনো sub-category নেই — উপরে থেকে যোগ করুন";
        chips.appendChild(empty);
      } else {
        items.forEach(s => {
          const chip = document.createElement("div");
          chip.className = "subcat-chip";
          const cnt = s.newsCount ? '<span class="subcat-chip-count">' + s.newsCount + '</span>' : '';
          chip.innerHTML = '<span class="subcat-chip-label">' + esc(s.name) + '</span>' + cnt + '<button class="subcat-chip-x" title="মুছুন" aria-label="Delete"><span class="ms" style="font-size:16px;line-height:1;">close</span></button>';
          chip.querySelector(".subcat-chip-x").addEventListener("click", () => deleteSubCategory(s.id, s.name));
          chips.appendChild(chip);
        });
      }
      block.appendChild(chips);
      subCatList.appendChild(block);
    }
  }

  window.addSubCategory = function(){
    if(!subCatParent.value){ alert("একটা parent category বাছাই করুন"); return; }
    const name = (subCatName.value || "").trim();
    if(!name){ alert("sub-category নাম দিন"); return; }
    fetch("/api/subcategories", {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ category: subCatParent.value, name })
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if(r.status === 401){ alert("Session expired."); logout(); return null; }
        if(!r.ok) throw new Error(data.error || "HTTP " + r.status);
        return data;
      })
      .then(res => {
        if(!res) return;
        subCatName.value = "";
        loadSubCategories();
      })
      .catch(err => alert("Add failed: " + err.message));
  };

  function deleteSubCategory(id, name){
    if(!confirm(`“${name}” sub-category মুছে ফেলতে চান?`)) return;
    fetch("/api/subcategories/" + id, {
      method: "DELETE",
      headers: authHeader()
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if(r.status === 401){ alert("Session expired."); logout(); return null; }
        if(!r.ok) throw new Error(data.error || "HTTP " + r.status);
        return data;
      })
      .then(res => {
        if(!res) return;
        loadSubCategories();
      })
      .catch(err => alert("Delete failed: " + err.message));
  }

  /* (filter wrappers defined further below) */

  function render(rows){
    list.innerHTML = "";
    if(rows.length === 0){
      list.innerHTML = `<div class="empty" style="font-size:18px;padding:30px;">কোনো সংবাদ নেই</div>`;
      return;
    }
    rows.forEach(n => {
      const sub = n.subcategory ? ` <span class="chip assist">${esc(n.subcategory)}</span>` : "";
      const vid = n.video ? ` <span class="chip red">▶ Video</span>` : "";
      list.innerHTML += `
        <div class="news-item" data-vid="${n.video ? 1 : 0}">
          <div class="info">
            <b>${esc(n.title)}</b>
            <small>${esc(n.category)}${sub}${vid}</small>
          </div>
          <div class="actions">
            <button class="small-btn" onclick="edit(${n.id})"><span class="ms" style="font-size:16px;">edit</span> Edit</button>
            <button class="small-btn btn-red" onclick="del(${n.id})"><span class="ms" style="font-size:16px;">delete</span> Delete</button>
          </div>
        </div>`;
    });
  }

  /* ===== STORIES FILTER ===== */
  const filterCatEl    = document.getElementById("filterCat");
  const filterSubEl    = document.getElementById("filterSub");
  const filterSearchEl = document.getElementById("filterSearch");
  const filterResetEl  = document.getElementById("filterReset");
  const storiesCountEl = document.getElementById("storiesCount");

  function populateFilterCat(){
    if(!filterCatEl) return;
    const prev = filterCatEl.value;
    filterCatEl.innerHTML = '<option value="" disabled selected> </option>';
    categoriesCache.forEach(c => {
      const o = document.createElement("option");
      o.value = c.category;
      o.textContent = c.category;
      filterCatEl.appendChild(o);
    });
    if(prev && categoriesCache.some(c => c.category === prev)) filterCatEl.value = prev;
  }
  function populateFilterSub(){
    if(!filterSubEl) return;
    const prev = filterSubEl.value;
    filterSubEl.innerHTML = '<option value="" disabled selected> </option>';
    if(!_filters.cat){
      filterSubEl.disabled = true;
      filterSubEl.value = "";
      return;
    }
    filterSubEl.disabled = false;
    const matching = (subCatsCache || []).filter(s => s.category === _filters.cat);
    if(matching.length === 0){
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "(no sub-categories)";
      o.disabled = true;
      filterSubEl.appendChild(o);
    } else {
      matching.forEach(s => {
        const o = document.createElement("option");
        o.value = s.name;
        o.textContent = s.name;
        filterSubEl.appendChild(o);
      });
    }
    if(prev && (matching.some(s => s.name === prev) || !prev)) filterSubEl.value = prev;
  }

  function renderFiltered(){
    let rows = newsCache.slice();
    if(_filters.cat) rows = rows.filter(r => r.category === _filters.cat);
    if(_filters.sub) rows = rows.filter(r => (r.subcategory || "") === _filters.sub);
    if(_filters.q){
      const q = _filters.q.toLowerCase();
      rows = rows.filter(r => (r.title || "").toLowerCase().includes(q) || (r.category || "").toLowerCase().includes(q) || (r.subcategory || "").toLowerCase().includes(q));
    }
    render(rows);
    if(storiesCountEl){
      const total = newsCache.length;
      const shown = rows.length;
      const filterActive = _filters.cat || _filters.sub || _filters.q;
      storiesCountEl.innerHTML = filterActive
        ? '<b>' + shown + '</b> / ' + total + ' <span style="opacity:.6;font-weight:500;">filtered</span>'
        : '<b>' + total + '</b> <span style="opacity:.6;font-weight:500;">stories</span>';
    }
  }

  if(filterCatEl){
    filterCatEl.addEventListener("change", () => {
      _filters.cat = filterCatEl.value;
      _filters.sub = "";
      populateFilterSub();
      renderFiltered();
    });
  }
  if(filterSubEl){
    filterSubEl.addEventListener("change", () => {
      _filters.sub = filterSubEl.value;
      renderFiltered();
    });
  }
  if(filterSearchEl){
    let _searchT;
    filterSearchEl.addEventListener("input", () => {
      clearTimeout(_searchT);
      _searchT = setTimeout(() => {
        _filters.q = filterSearchEl.value.trim();
        renderFiltered();
      }, 180);
    });
  }
  if(filterResetEl){
    filterResetEl.addEventListener("click", () => {
      _filters = { cat: "", sub: "", q: "" };
      if(filterCatEl) filterCatEl.value = "";
      if(filterSearchEl) filterSearchEl.value = "";
      populateFilterSub();
      renderFiltered();
    });
  }

  /* re-populate filter dropdowns whenever categories/subcats change */
  const _origLoadCategories2 = loadCategories;
  loadCategories = function(){
    _origLoadCategories2();
    /* poll categoriesCache until populated (max ~3s) */
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(categoriesCache.length > 0 || tries > 30){
        clearInterval(t);
        populateFilterCat();
      }
    }, 100);
  };
  const _origLoadSubCats = loadSubCategories;
  loadSubCategories = function(){
    _origLoadSubCats();
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(subCatsCache.length > 0 || tries > 30){
        clearInterval(t);
        populateFilterSub();
      }
    }, 100);
  };

  /* ===== EDIT ===== */
  window.edit = function(id){
    fetch("/api/news/" + id, { headers: authHeader() })
      .then(r => r.json())
      .then(n => {
        title.value    = n.title;
        category.value = n.category;
        renderSubcategorySelect();
        /* subcat dropdown render হওয়ার পর value সেট করি (subCategories loaded হলে
           option exist করবে, না হলে fallback হিসেবে নিচে সরাসরি সেট) */
        if(subcat){
          const exists = Array.from(subcat.options).some(o => o.value === (n.subcategory || ""));
          if(exists || !n.subcategory) subcat.value = n.subcategory || "";
        }
        details.value  = n.details;
        document.getElementById("imageUrl").value  = (n.image && !n.image.startsWith("data:")) ? n.image : "";
        document.getElementById("video").value     = n.video || "";
        editId         = id;
        img.value      = "";
        const card = document.getElementById("formCardTitle");
        if(card) card.innerHTML = '<span class="md-icon"><span class="ms">edit</span></span>এডিট: ' + esc(n.title.length > 40 ? n.title.slice(0,40) + "…" : n.title);
        const pubBtn = document.querySelector('button[onclick="save()"]');
        if(pubBtn) pubBtn.innerHTML = '<span class="ms">update</span> আপডেট করুন';
        let cancelBtn = document.getElementById("cancelEditBtn");
        if(!cancelBtn){
          cancelBtn = document.createElement("button");
          cancelBtn.id = "cancelEditBtn";
          cancelBtn.type = "button";
          cancelBtn.className = "btn-outlined btn-block";
          cancelBtn.style.marginTop = "8px";
          cancelBtn.innerHTML = '<span class="ms">close</span> এডিট বাতিল';
          cancelBtn.onclick = () => { clear(); };
          pubBtn?.parentNode?.insertBefore(cancelBtn, pubBtn?.nextSibling);
        }
        showSection("posts");
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast("এডিট মোড: " + n.title.slice(0, 36) + (n.title.length > 36 ? "…" : ""));
      })
      .catch(err => toast("Edit load failed: " + err.message, "error"));
  };

  /* ===== DELETE ===== */
  window.del = function(id){
    if(!confirm("এই সংবাদটি মুছে ফেলতে চান?")) return;

    fetch("/api/news/" + id, { method: "DELETE", headers: authHeader() })
      .then(r => {
        if(r.status === 401){ logout(); return null; }
        if(!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(res => {
        if(res) load();
      })
      .catch(err => alert("Delete failed: " + err.message));
  };

  /* ===== CLEAR FORM ===== */
  function clear(){
    title.value   = "";
    details.value = "";
    img.value     = "";
    const iu = document.getElementById("imageUrl");     if(iu) iu.value = "";
    const vv = document.getElementById("video");        if(vv) vv.value = "";
    if(subcat){
      renderSubcategorySelect();
    }
    editId        = null;
    const card = document.getElementById("formCardTitle");
    if(card) card.innerHTML = '<span class="md-icon"><span class="ms">post_add</span></span>Add / Edit News';
    const pubBtn = document.querySelector('button[onclick="save()"]');
    if(pubBtn) pubBtn.innerHTML = '<span class="ms">publish</span> Publish';
    const cancelBtn = document.getElementById("cancelEditBtn");
    if(cancelBtn) cancelBtn.remove();
  }

  /* expose to window for inline handlers */
  window.clear = clear;

  /* ===== PROFILE ===== */
  window.loadProfile = function(){
    const note = document.getElementById("profileNote");
    if(note){ note.style.display = "none"; note.classList.remove("ok"); note.innerHTML = ""; }
    fetch("/api/admin/profile", { headers: authHeader() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(p => {
        document.getElementById("pUsername").value    = p.username || "";
        document.getElementById("pDisplayName").value = p.display_name || "";
        document.getElementById("pEmail").value       = p.email || "";
        document.getElementById("pPhone").value       = p.phone || "";
        document.getElementById("profileName").textContent = p.display_name || p.username || "Admin";
        document.getElementById("profileRole").textContent = p.role || "admin";
        const created = p.created_at ? p.created_at.slice(0,16).replace("T"," ") : "—";
        const last    = p.last_login  ? p.last_login.slice(0,16).replace("T"," ") : "—";
        const src     = p.source === "env" ? " · (env-managed)" : "";
        document.getElementById("profileMeta").innerHTML =
          '<span><span class="ms">schedule</span> joined ' + esc(created) + '</span>' +
          '<span><span class="ms">login</span> last login ' + esc(last) + '</span>' +
          (src ? '<span style="opacity:.7;">' + esc(src) + '</span>' : '');
        /* email + phone chips (only show if present) */
        const contacts = document.getElementById("profileContacts");
        if(contacts){
          const c = [];
          if(p.email) c.push('<a class="prof-chip" href="mailto:' + esc(p.email) + '"><span class="ms">mail</span>' + esc(p.email) + '</a>');
          if(p.phone) c.push('<a class="prof-chip" href="tel:' + esc(p.phone) + '"><span class="ms">call</span>' + esc(p.phone) + '</a>');
          contacts.innerHTML = c.join("");
        }
        /* also update sidebar admin name + role + avatar */
        const sbName = document.getElementById("sbUserName");
        if(sbName) sbName.textContent = p.display_name || p.username || "Admin";
        const sbRole = document.getElementById("sbUserRole");
        if(sbRole) sbRole.textContent = p.role || "admin";
        const sbAv = document.getElementById("sbAvatar");
        if(sbAv){
          const letter = (p.display_name || p.username || "A").trim().charAt(0).toUpperCase();
          sbAv.textContent = letter;
        }
      })
      .catch(err => {
        if(note){
          note.style.display = "block";
          note.classList.remove("ok");
          note.textContent = "Profile load failed: " + err.message;
        }
      });
  };

  window.saveProfile = function(){
    const note = document.getElementById("profileNote");
    const u = document.getElementById("pUsername").value.trim();
    const dn = document.getElementById("pDisplayName").value.trim();
    const em = document.getElementById("pEmail").value.trim();
    const ph = document.getElementById("pPhone").value.trim();
    const cur = document.getElementById("pCurrentPass").value;
    const np  = document.getElementById("pNewPass").value;
    const cp  = document.getElementById("pConfirmPass").value;

    if(!u){ return showNote(note, false, "Username দিতে হবে"); }
    if(np && np !== cp){ return showNote(note, false, "নতুন password দুটি মিলছে না"); }
    if(np && !cur){ return showNote(note, false, "Password বদলাতে হলে current password দিতে হবে"); }

    const body = { username: u, display_name: dn, email: em, phone: ph };
    if(np){ body.current_password = cur; body.new_password = np; }

    fetch("/api/admin/profile", {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      })
      .then(j => {
        /* if username changed, must re-authenticate */
        if(j.username && j.username !== credentials.u){
          toast("Username পরিবর্তন হয়েছে — নতুন username দিয়ে login করুন");
          setTimeout(() => logout(), 1500);
        } else {
          toast("Profile saved ✓");
          document.getElementById("pCurrentPass").value = "";
          document.getElementById("pNewPass").value = "";
          document.getElementById("pConfirmPass").value = "";
          loadProfile();
        }
      })
      .catch(err => showNote(note, false, err.message));
  };

  function showNote(el, ok, msg){
    if(!el) return;
    el.style.display = "block";
    el.classList.toggle("ok", !!ok);
    el.textContent = msg;
  }

  /* Load profile when profile section opens */
  document.querySelectorAll('.sb-link[data-section="profile"]').forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showSection("profile");
      loadProfile();
    });
  });

  /* ============================================================
     INBOX
     ============================================================ */
  let _inboxMessages = [];
  let _inboxFilter = "all";
  let _inboxQ = "";
  let _inboxSelected = null;
  let _inboxSearchTimer = null;

  window.loadInbox = async function(){
    try {
      const params = new URLSearchParams({ filter: _inboxFilter, q: _inboxQ });
      const r = await fetch("/api/inbox?" + params, { headers: authHeader() });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "HTTP " + r.status);
      _inboxMessages = j.messages || [];
      const c = j.counts || {};
      document.getElementById("ifCountAll").textContent     = c.total     || 0;
      document.getElementById("ifCountUnread").textContent  = c.unread    || 0;
      document.getElementById("ifCountStarred").textContent = c.starred   || 0;
      document.getElementById("ifCountArchived").textContent= c.archived  || 0;
      document.getElementById("ifCountSpam").textContent    = c.spam      || 0;
      const cnt = document.getElementById("cntInbox");
      if(cnt){
        const u = c.unread || 0;
        cnt.style.display = u > 0 ? "" : "none";
        cnt.textContent = u > 99 ? "99+" : String(u);
      }
      renderInboxList();
      if(_inboxSelected && !_inboxMessages.find(m => m.id === _inboxSelected)){
        _inboxSelected = null;
        renderInboxView();
      }
    } catch (err) {
      console.error("inbox load:", err);
      toast("Inbox load failed: " + err.message, "error");
    }
  };

  function renderInboxList(){
    const wrap = document.getElementById("inboxItems");
    if(!wrap) return;
    if(!_inboxMessages.length){
      wrap.innerHTML = '<div class="inbox-empty">No messages in this view.</div>';
      return;
    }
    wrap.innerHTML = _inboxMessages.map(m => {
      const initial = (m.from_name || m.from_email || "?").trim().charAt(0).toUpperCase();
      const isActive = _inboxSelected === m.id ? " active" : "";
      const isUnread = !m.read && !m.archived && !m.spam ? " unread" : "";
      const isStarred = m.starred ? " starred" : "";
      const from = m.from_name || m.from_email || "(unknown)";
      return '<div class="inbox-item' + isActive + isUnread + isStarred + '" onclick="openInboxMessage(' + m.id + ')">' +
        '<div class="inbox-avatar">' + esc(initial) + '</div>' +
        '<div class="inbox-item-body">' +
          '<div class="inbox-item-from">' + esc(from) + '</div>' +
          '<div class="inbox-item-subject">' + esc(m.subject || "(no subject)") + '</div>' +
          '<div class="inbox-item-snippet">' + esc(m.snippet || "") + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="inbox-item-time">' + esc(inboxTime(m.created_at)) + '</div>' +
          '<div class="inbox-item-star">' + (m.starred ? '★' : '☆') + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function inboxTime(iso){
    if(!iso) return "";
    const t = iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z");
    const d = new Date(t);
    if(isNaN(d)) return iso;
    const now = new Date();
    const diff = (now - d) / 1000;
    if(diff < 60) return "just now";
    if(diff < 3600) return Math.floor(diff/60) + "m";
    if(diff < 86400) return Math.floor(diff/3600) + "h";
    if(diff < 86400*7) return Math.floor(diff/86400) + "d";
    return d.toLocaleDateString("en-GB", { day:"numeric", month:"short" });
  }

  window.openInboxMessage = async function(id){
    _inboxSelected = id;
    renderInboxList();
    renderInboxView();
    try {
      const r = await fetch("/api/inbox/" + id, { headers: authHeader() });
      const m = await r.json();
      if(!r.ok) throw new Error(m.error || "HTTP " + r.status);
      Object.assign(_inboxMessages.find(x => x.id === id) || {}, { read: 1 });
      renderInboxList();
      renderInboxView(m);
      /* refresh unread count */
      loadInbox();
    } catch (err) {
      toast("Load message failed: " + err.message, "error");
    }
  };

  function renderInboxView(m){
    const v = document.getElementById("inboxView");
    if(!v) return;
    if(!m){
      v.innerHTML = '<div class="inbox-empty">Select a message to read</div>';
      return;
    }
    const initial = (m.from_name || m.from_email || "?").trim().charAt(0).toUpperCase();
    const fromLine = m.from_name
      ? esc(m.from_name) + ' &lt;<a href="mailto:' + esc(m.from_email) + '">' + esc(m.from_email) + '</a>&gt;'
      : '<a href="mailto:' + esc(m.from_email) + '">' + esc(m.from_email) + '</a>';
    const fullDate = m.created_at ? m.created_at.replace(" ", "T") + "Z" : "";
    const d = fullDate ? new Date(fullDate) : null;
    const dateStr = d && !isNaN(d) ? d.toLocaleString() : m.created_at;
    const replyHref = "mailto:" + (m.from_email || "") +
      "?subject=" + encodeURIComponent((m.subject || "").startsWith("Re:") ? m.subject : "Re: " + (m.subject || "")) +
      "&body=" + encodeURIComponent("\n\n--- Original message ---\nFrom: " + (m.from_name || m.from_email) + "\nDate: " + dateStr + "\n\n");
    v.innerHTML =
      '<div class="inbox-view-head">' +
        '<div class="inbox-avatar">' + esc(initial) + '</div>' +
        '<div class="inbox-view-meta">' +
          '<div class="inbox-view-subject">' + esc(m.subject || "(no subject)") + '</div>' +
          '<div class="inbox-view-from">From: ' + fromLine + ' · ' + esc(dateStr) + '</div>' +
        '</div>' +
        '<div class="inbox-view-actions">' +
          '<button class="btn-text" onclick="toggleInboxStar(' + m.id + ')" title="Star"><span class="ms">' + (m.starred ? 'star' : 'star_border') + '</span></button>' +
          '<button class="btn-text" onclick="toggleInboxArchive(' + m.id + ')" title="Archive"><span class="ms">' + (m.archived ? 'unarchive' : 'archive') + '</span></button>' +
          '<button class="btn-text" onclick="toggleInboxSpam(' + m.id + ')" title="Spam"><span class="ms">report</span></button>' +
          '<button class="btn-text" onclick="deleteInboxMessage(' + m.id + ')" title="Delete"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="inbox-view-body">' + esc(m.body_text || (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "(no body)")) + '</div>' +
      '<div class="inbox-view-foot">' +
        '<a class="btn-tonal" href="' + replyHref + '" style="text-decoration:none;">' +
          '<span class="ms">reply</span> Reply via mail client' +
        '</a>' +
        '<span class="inbox-meta-foot" style="font-size:11px;color:var(--md-on-surface-var);opacity:.7;align-self:center;">' +
          'Source: ' + esc(m.source || "?") + (m.message_id ? " · ID: " + esc(m.message_id.slice(0,40)) : "") +
        '</span>' +
      '</div>';
  }

  window.addTestMessage = function(){
    fetch("/api/inbox/test", { method: "POST", headers: authHeader() })
      .then(r => r.json())
      .then(j => {
        if(!j.ok) throw new Error(j.error || "failed");
        toast("Test message added ✓");
        _inboxSelected = j.id;
        loadInbox().then(() => openInboxMessage(j.id));
      })
      .catch(err => toast("Test failed: " + err.message, "error"));
  };

  window.toggleInboxStar = function(id){
    const m = _inboxMessages.find(x => x.id === id);
    if(!m) return;
    const action = m.starred ? "unstar" : "star";
    fetch("/api/inbox/" + id + "/" + action, { method: "PUT", headers: authHeader() })
      .then(() => { m.starred = m.starred ? 0 : 1; renderInboxList(); loadInbox(); });
  };
  window.toggleInboxArchive = function(id){
    const m = _inboxMessages.find(x => x.id === id);
    if(!m) return;
    const action = m.archived ? "unarchive" : "archive";
    fetch("/api/inbox/" + id + "/" + action, { method: "PUT", headers: authHeader() })
      .then(() => { m.archived = m.archived ? 0 : 1; loadInbox(); });
  };
  window.toggleInboxSpam = function(id){
    const m = _inboxMessages.find(x => x.id === id);
    if(!m) return;
    const action = m.spam ? "unspam" : "spam";
    fetch("/api/inbox/" + id + "/" + action, { method: "PUT", headers: authHeader() })
      .then(() => { m.spam = m.spam ? 0 : 1; loadInbox(); });
  };
  window.deleteInboxMessage = function(id){
    if(!confirm("Delete this message?")) return;
    fetch("/api/inbox/" + id, { method: "DELETE", headers: authHeader() })
      .then(() => { _inboxSelected = null; loadInbox(); renderInboxView(); toast("Deleted"); });
  };
  window.showInboxSetup = async function(){
    try {
      const r = await fetch("/api/inbox/worker-code", { headers: authHeader() });
      const j = await r.json();
      const code = j.code;
      const w = window.open("", "worker", "width=900,height=700");
      w.document.write(
        '<title>Cloudflare Email Worker</title>' +
        '<pre style="font:12px/1.5 monospace;padding:16px;background:#1e1e1e;color:#d4d4d4;white-space:pre-wrap;word-break:break-word;">' +
        code.replace(/</g,"&lt;").replace(/>/g,"&gt;") +
        '</pre>' +
        '<div style="padding:14px;font:13px sans-serif;background:#fff;color:#222;">' +
        '<b>Setup steps:</b><ol style="margin:8px 0 0 20px;line-height:1.7;">' +
        '<li>Cloudflare Dashboard → <b>Email</b> → <b>Email Routing</b> → enable for <code>prothom-songbad.com</code></li>' +
        '<li><b>Email Workers</b> → <b>Create</b> → paste the code above</li>' +
        '<li>Worker → <b>Settings</b> → Variables: <code>WEBHOOK_URL</code> = <code>' + j.webhookUrl + '</code> + <code>WEBHOOK_SECRET</code> = (same as Vercel env <code>INBOX_WEBHOOK_SECRET</code>)</li>' +
        '<li>Email Routing → <b>Routing rules</b> → <b>Create</b> → <b>Catch-all</b> for <code>prothom-songbad.com</code> → action = <b>Send to Worker</b> → select your worker</li>' +
        '<li>Vercel env: add <code>INBOX_WEBHOOK_SECRET</code> = (same secret)</li>' +
        '<li>Send test email to <code>admin@prothom-songbad.com</code> — it should appear here within seconds</li>' +
        '</ol></div>'
      );
    } catch (err) {
      toast("Failed: " + err.message, "error");
    }
  };

  /* inbox section open */
  document.querySelectorAll('.sb-link[data-section="inbox"]').forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showSection("inbox");
      loadInbox();
    });
  });
  /* inbox filter chips */
  document.querySelectorAll("#inboxFilters .if-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#inboxFilters .if-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _inboxFilter = btn.dataset.filter;
      loadInbox();
    });
  });
  /* inbox search (debounced) */
  const inboxSearchEl = document.getElementById("inboxSearch");
  if(inboxSearchEl){
    inboxSearchEl.addEventListener("input", () => {
      clearTimeout(_inboxSearchTimer);
      _inboxSearchTimer = setTimeout(() => {
        _inboxQ = inboxSearchEl.value.trim();
        loadInbox();
      }, 250);
    });
  }

  /* ===== BANNERS / ADS ===== */
  let _bannersCache = [];
  let _editingBannerId = null;

  const bnPosSel   = document.getElementById("bnPosition");
  const bnTitleEl  = document.getElementById("bnTitle");
  const bnOrderEl  = document.getElementById("bnOrder");
  const bnImageEl  = document.getElementById("bnImage");
  const bnLinkEl   = document.getElementById("bnLink");
  const bnActiveEl = document.getElementById("bnActive");
  const bnSaveBtn  = document.getElementById("bnSaveBtn");
  const bnPreviewWrap = document.getElementById("bnPreview");
  const bnPreviewImg  = document.getElementById("bnPreviewImg");
  const bnFilterPos   = document.getElementById("bnFilterPos");
  const bannerList    = document.getElementById("bannerList");
  const cntBannersEl  = document.getElementById("cntBanners");

  function updateBannerPreview(){
    const url = (bnImageEl?.value || "").trim();
    if(url && /^https?:\/\//i.test(url)){
      bnPreviewWrap.style.display = "block";
      bnPreviewImg.src = url;
    } else {
      bnPreviewWrap.style.display = "none";
    }
  }
  if(bnImageEl) bnImageEl.addEventListener("input", updateBannerPreview);

  function resetBannerForm(){
    _editingBannerId = null;
    if(bnSaveBtn) bnSaveBtn.innerHTML = '<span class="ms">add</span> Add Banner';
    if(bnPosSel)   bnPosSel.value = "sidebar-bottom";
    if(bnTitleEl)  bnTitleEl.value = "";
    if(bnOrderEl)  bnOrderEl.value = "0";
    if(bnImageEl)  bnImageEl.value = "";
    if(bnLinkEl)   bnLinkEl.value = "";
    if(bnActiveEl) bnActiveEl.checked = true;
    if(bnPreviewWrap) bnPreviewWrap.style.display = "none";
  }
  window.resetBannerForm = resetBannerForm;

  function renderBannerList(rows){
    if(!bannerList) return;
    const pos = bnFilterPos?.value || "";
    const filtered = pos ? rows.filter(r => r.position === pos) : rows;
    if(filtered.length === 0){
      bannerList.innerHTML = '<div class="banner-empty"><span class="ms">image_not_supported</span>' +
        (pos ? "এই position-এ কোনো banner নেই" : "কোনো banner যোগ করা হয়নি — উপরের form থেকে যোগ করুন") + '</div>';
      return;
    }
    bannerList.innerHTML = filtered.map(b => {
      const off = !b.active ? " off" : "";
      const title = b.title || "(no title)";
      const safeTitle = esc(title);
      const safePos = esc(b.position);
      const safeUrl = esc(b.image_url);
      const safeLink = esc(b.link_url || "");
      return `<div class="banner-card${off}">` +
        `<div class="banner-card-img">` +
          (b.image_url
            ? `<img src="${safeUrl}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="ms" style="display:none;">broken_image</span>`
            : `<span class="ms">image</span>`) +
        `</div>` +
        `<div class="banner-card-body">` +
          `<div class="banner-card-pos"><span class="ms" style="font-size:12px;">place</span>${safePos}</div>` +
          `<div class="banner-card-title" title="${safeTitle}">${safeTitle}</div>` +
          (b.link_url ? `<div style="font-size:11px;color:var(--md-on-surface-var);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeLink}">→ ${safeLink}</div>` : '') +
          `<div class="banner-card-actions">` +
            `<button class="btn-text" onclick="editBanner(${b.id})" type="button"><span class="ms" style="font-size:14px;">edit</span> Edit</button>` +
            `<button class="btn-text" onclick="toggleBanner(${b.id}, ${b.active ? 0 : 1})" type="button"><span class="ms" style="font-size:14px;">${b.active ? 'pause' : 'play_arrow'}</span> ${b.active ? 'Off' : 'On'}</button>` +
            `<button class="btn-text" style="color:var(--md-error);" onclick="deleteBanner(${b.id})" type="button"><span class="ms" style="font-size:14px;">delete</span> Del</button>` +
          `</div>` +
        `</div>` +
      `</div>`;
    }).join("");
  }

  function loadBanners(){
    fetch("/api/banners", { headers: authHeader() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(rows => {
        _bannersCache = rows;
        renderBannerList(rows);
        if(cntBannersEl) cntBannersEl.textContent = rows.length || 0;
      })
      .catch(err => toast("Banners load failed: " + err.message, "error"));
  }
  window.loadBanners = loadBanners;

  window.saveBanner = function(){
    const body = {
      position: bnPosSel?.value || "sidebar-bottom",
      title: bnTitleEl?.value || "",
      image_url: bnImageEl?.value || "",
      link_url: bnLinkEl?.value || "",
      active: !!bnActiveEl?.checked,
      sort_order: Number(bnOrderEl?.value || 0)
    };
    if(!body.image_url || !/^https?:\/\//i.test(body.image_url)){
      return toast("Image URL দিতে হবে (http/https দিয়ে শুরু হতে হবে)", "error");
    }
    const isEdit = _editingBannerId !== null;
    const url = isEdit ? "/api/banners/" + _editingBannerId : "/api/banners";
    fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      })
      .then(() => {
        toast(isEdit ? "Banner updated ✓" : "Banner added ✓");
        resetBannerForm();
        loadBanners();
      })
      .catch(err => toast("Save failed: " + err.message, "error"));
  };

  window.editBanner = function(id){
    const b = _bannersCache.find(x => x.id === id);
    if(!b) return;
    _editingBannerId = id;
    if(bnPosSel)   bnPosSel.value = b.position;
    if(bnTitleEl)  bnTitleEl.value = b.title || "";
    if(bnOrderEl)  bnOrderEl.value = b.sort_order || 0;
    if(bnImageEl)  bnImageEl.value = b.image_url || "";
    if(bnLinkEl)   bnLinkEl.value = b.link_url || "";
    if(bnActiveEl) bnActiveEl.checked = !!b.active;
    if(bnSaveBtn)  bnSaveBtn.innerHTML = '<span class="ms">save</span> Update Banner';
    updateBannerPreview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.toggleBanner = function(id, newActive){
    fetch("/api/banners/" + id, {
      method: "PUT",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ active: newActive })
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(() => { toast(newActive ? "Banner activated" : "Banner deactivated"); loadBanners(); })
      .catch(err => toast("Toggle failed: " + err.message, "error"));
  };

  window.deleteBanner = function(id){
    if(!confirm("এই banner মুছে ফেলতে চান?")) return;
    fetch("/api/banners/" + id, { method: "DELETE", headers: authHeader() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
      .then(() => { toast("Banner deleted"); loadBanners(); })
      .catch(err => toast("Delete failed: " + err.message, "error"));
  };

  if(bnFilterPos) bnFilterPos.addEventListener("change", () => renderBannerList(_bannersCache));

  document.querySelectorAll('.sb-link[data-section="banners"]').forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showSection("banners");
      loadBanners();
    });
  });

})();
