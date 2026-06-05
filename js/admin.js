/* ==========================================================
   ADMIN.JS — Admin panel (API + HTTP Basic Auth)
   ========================================================== */

(function(){

  let credentials = null;   // { u, p }
  let editId      = null;   // currently edited news id

  const loginBox = document.getElementById("loginBox");
  const admin    = document.getElementById("admin");
  const u        = document.getElementById("u");
  const p        = document.getElementById("p");
  const title    = document.getElementById("title");
  const category = document.getElementById("category");
  const details  = document.getElementById("details");
  const img      = document.getElementById("img");
  const list     = document.getElementById("list");
  const catList  = document.getElementById("catList");
  const newCat   = document.getElementById("newCat");

  let categoriesCache = [];

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

  /* ===== SAVE / PUBLISH (create or update) ===== */
  window.save = function(){
    if(!title.value || !category.value || !details.value){
      alert("Title, Category, Details সবগুলো দিতে হবে");
      return;
    }

    const isEdit = editId !== null;
    if(!isEdit && !img.files[0] && !document.getElementById("imageUrl").value){
      alert("Image required");
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
        if(r.status === 401){ alert("Session expired. Please login again."); logout(); return null; }
        if(!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(saved => {
        if(!saved) return;
        clear();
        load();
      })
      .catch(err => alert("Save failed: " + err.message));
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
      })
      .catch(err => console.error("Category load failed:", err));
  }

  function renderCategorySelect(){
    const prev = category.value;
    category.innerHTML = "";
    if(categoriesCache.length === 0){
      const opt = document.createElement("option");
      opt.textContent = "— কোনো ক্যাটাগরি নেই —";
      opt.disabled = true;
      opt.selected = true;
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
  let subCatsCache   = []; /* all subcategories grouped by parent */

  function loadSubCategories(){
    fetch("/api/subcategories", { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        subCatsCache = rows || [];
        renderSubCatParent();
        renderSubCatList();
      })
      .catch(() => {
        if(subCatList) subCatList.innerHTML = `<div class="empty" style="font-size:14px;padding:20px;">লোড করা যাচ্ছে না</div>`;
      });
  }

  function renderSubCatParent(){
    if(!subCatParent) return;
    const prev = subCatParent.value;
    subCatParent.innerHTML = "";
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
    for (const cat of Object.keys(grouped).sort()){
      const block = document.createElement("div");
      block.style.cssText = "margin-bottom:18px;padding:14px;background:#faf6ec;border:1px solid #e5dfd0;border-radius:6px;";
      const head = document.createElement("div");
      head.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;color:#c1131d;letter-spacing:.04em;";
      head.textContent = cat;
      block.appendChild(head);

      const tags = document.createElement("div");
      tags.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
      grouped[cat].forEach(s => {
        const tag = document.createElement("span");
        tag.style.cssText = "display:inline-flex;align-items:center;gap:8px;padding:5px 10px;background:#fff;border:1px solid #0a0a0a;border-radius:999px;font-size:13px;font-family:'Hind Siliguri',sans-serif;";
        const label = document.createElement("span");
        label.textContent = s.name + (s.newsCount ? ` (${s.newsCount})` : "");
        const x = document.createElement("button");
        x.textContent = "✕";
        x.title = "মুছুন";
        x.style.cssText = "background:none;border:none;color:#c1131d;cursor:pointer;font-size:14px;line-height:1;padding:0;";
        x.addEventListener("click", () => deleteSubCategory(s.id, s.name));
        tag.appendChild(label);
        tag.appendChild(x);
        tags.appendChild(tag);
      });
      block.appendChild(tags);
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
      const sub = n.subcategory ? ` › ${esc(n.subcategory)}` : "";
      const vid = n.video ? ` <span style="color:#c1131d">▶</span>` : "";
      list.innerHTML += `
        <div class="news-item">
          <div class="info">
            <b>${esc(n.title)}${vid}</b>
            <small>${esc(n.category)}${sub}</small>
          </div>
          <div class="actions">
            <button class="small-btn" onclick="edit(${n.id})">Edit</button>
            <button class="small-btn" onclick="del(${n.id})">Delete</button>
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
        details.value  = n.details;
        document.getElementById("imageUrl").value  = (n.image && !n.image.startsWith("data:")) ? n.image : "";
        document.getElementById("video").value     = n.video || "";
        document.getElementById("subcategory").value = n.subcategory || "";
        editId         = id;
        img.value      = "";
        const card = document.querySelector(".card h3");
        if(card) card.innerText = "Editing: " + (n.title.length > 40 ? n.title.slice(0,40) + "…" : n.title);
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
    const ss = document.getElementById("subcategory");  if(ss) ss.value = "";
    editId        = null;
    const card = document.querySelector(".card h3");
    if(card) card.innerText = "Add / Edit News";
  }

  /* expose to window for inline handlers */
  window.clear = clear;

})();
