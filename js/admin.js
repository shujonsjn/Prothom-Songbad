/* ==========================================================
   ADMIN.JS — Admin panel (API + HTTP Basic Auth)
   ========================================================== */

(function(){

  let credentials = null;   // { u, p }
  let editId      = null;   // currently edited news id

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

  let categoriesCache = [];
  let subCatsCache    = [];

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
      if (name) showSection(name);
    });
  });

  function refreshSidebarCounts(){
    if(cntPostsEl) cntPostsEl.textContent = (list && list.children.length) || 0;
    if(cntCatsEl)  cntCatsEl.textContent  = categoriesCache.length || 0;
    if(cntSubsEl)  cntSubsEl.textContent  = (subCatsCache || []).length || 0;
    const statPostsEl = document.getElementById("statPosts");
    const statCatsEl  = document.getElementById("statCats");
    const statSubsEl  = document.getElementById("statSubs");
    const statVidsEl  = document.getElementById("statVids");
    if(statPostsEl) statPostsEl.textContent = (list && list.children.length) || 0;
    if(statCatsEl)  statCatsEl.textContent  = categoriesCache.length || 0;
    if(statSubsEl)  statSubsEl.textContent  = (subCatsCache || []).length || 0;
    if(statVidsEl)  statVidsEl.textContent  = (list ? list.querySelectorAll("[data-vid='1']").length : 0);
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
        render(rows);
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
      row.innerHTML = `
        <div class="cat-info">
          <b>${esc(c.category)}</b>
          <small>${c.count}টি সংবাদ</small>
        </div>
        <div class="actions">
          <button class="small-btn" data-name="${esc(c.category)}" data-action="del">Delete</button>
        </div>`;
      catList.appendChild(row);
    });
    catList.querySelectorAll('button[data-action="del"]').forEach(btn => {
      btn.addEventListener("click", () => deleteCategory(btn.dataset.name));
    });
  }

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

    /* placeholder */
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = parent ? `— Sub-category (optional) —` : `— আগে main category বাছাই করুন —`;
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
    if(subCatsCache.length === 0){
      subCatList.innerHTML = `<div class="empty" style="font-size:14px;padding:20px;">কোনো sub-category নেই — উপরে থেকে যোগ করুন</div>`;
      return;
    }
    /* parent category অনুযায়ী group */
    const grouped = {};
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
    for (const cat of Object.keys(grouped).sort()){
      const color = palette[pi++ % palette.length];
      const items = grouped[cat];
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
      items.forEach(s => {
        const chip = document.createElement("div");
        chip.className = "subcat-chip";
        const cnt = s.newsCount ? '<span class="subcat-chip-count">' + s.newsCount + '</span>' : '';
        chip.innerHTML = '<span class="subcat-chip-label">' + esc(s.name) + '</span>' + cnt + '<button class="subcat-chip-x" title="মুছুন" aria-label="Delete"><span class="ms" style="font-size:16px;line-height:1;">close</span></button>';
        chip.querySelector(".subcat-chip-x").addEventListener("click", () => deleteSubCategory(s.id, s.name));
        chips.appendChild(chip);
      });
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

  /* Refresh sub-cat parent dropdown when categories change */
  const _origLoadCategories = loadCategories;
  loadCategories = function(){
    _origLoadCategories();
    /* এই wrapper loadCategories এর return Promise ধরে না;
       original function explicit return করে না, তাই .then() চেইন করা যায় না।
       renderSubCatParent আগে থেকেই original এ কল হয়, তাই এখানে আর
       কিছু করার দরকার নেই। */
  };

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
        const card = document.querySelector(".card h3");
        if(card) card.innerText = "Editing: " + (n.title.length > 40 ? n.title.slice(0,40) + "." : n.title);
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(err => alert("Edit load failed: " + err.message));
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
      /* category select রাখি, শুধু subcat empty করে dropdown refresh করি */
      renderSubcategorySelect();
    }
    editId        = null;
    const card = document.querySelector(".card h3");
    if(card) card.innerText = "Add / Edit News";
  }

  /* expose to window for inline handlers */
  window.clear = clear;

})();
