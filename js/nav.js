(function(){

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]
    ));
  }

  const params  = new URLSearchParams(window.location.search);
  const activeCat = params.get("cat") || "all";

  function render(cats){
    const menu = document.getElementById("navMenu");
    if(!menu) return;

    const allLink = `<a href="index.html" data-cat="all"${activeCat === "all" ? ' class="active"' : ""}>সর্বশেষ</a>`;
    const catLinks = (cats || []).map(c =>
      `<a href="index.html?cat=${encodeURIComponent(c.category)}" data-cat="${esc(c.category)}"${activeCat === c.category ? ' class="active"' : ""}>${esc(c.category)}</a>`
    ).join("");

    const profileLink = `<a href="#" class="nav-profile-link" onclick="openProfileModal();return false;"><span class="ms">person</span> প্রোফাইল</a>`;
    menu.innerHTML = allLink + catLinks + profileLink;
  }

  fetch("/api/categories")
    .then(r => r.ok ? r.json() : [])
    .then(arr => (arr || []).filter(c => !c.hidden))
    .then(render)
    .catch(() => {
      const menu = document.getElementById("navMenu");
      if(menu) menu.innerHTML = `<a href="index.html" data-cat="all" class="active">সর্বশেষ</a>`;
    });

  /* initial nav avatar from stored session */
  async function refreshSession(){
    const saved = localStorage.getItem("sub_session");
    if(!saved) return null;
    let s;
    try { s = JSON.parse(saved); } catch(e){ return null; }
    if(!s.email) return null;
    /* skip profile fetch for admin emails (fake admin email not in DB) */
    if(s.is_admin || s.email.endsWith("@admin.prothom-songbad.com")){
      return s.name ? s : null;
    }
    try {
      const r = await fetch("/api/subscriber/profile?email=" + encodeURIComponent(s.email));
      if(r.ok){
        const d = await r.json();
        const sub = d.subscriber;
        if(sub){
          const sess = { email: sub.email, name: sub.name, phone: sub.phone||"", active: sub.active, address: sub.address||"", avatar: sub.avatar||"" };
          if(s.is_admin) sess.is_admin = true;
          localStorage.setItem("sub_session", JSON.stringify(sess));
          return sess;
        }
      }
    } catch(e){}
    return s.name ? s : null;
  }

  (async function(){
    const s = await refreshSession();
    if(s){ updateNavAvatar(s); return; }
    updateNavAvatar(null);
  })();

  /* ===== Profile Modal ===== */

  function updateNavAvatar(s){
    const link = document.querySelector(".nav-profile-link");
    if(!link) return;
    if(s && s.email && s.name){
      const initial = s.name[0].toUpperCase();
      const style = s.avatar ? `background-image:url('${s.avatar.replace(/'/g, "%27")}');` : "";
      link.innerHTML = `<span class="nav-av" style="${style}">${style ? "" : initial}</span>`;
    } else {
      link.innerHTML = `<span class="ms">person</span> প্রোফাইল`;
    }
  }

  window.openProfileModal = function(fromEvent){
    const modal = id("profileModal");
    if(!modal) return;
    modal.style.display = "block";
    /* position near the profile link */
    const link = document.querySelector(".nav-profile-link");
    if(link && window.innerWidth > 600){
      const rect = link.getBoundingClientRect();
      const mw = 380;
      let left = rect.left;
      let top = rect.bottom + 6;
      if(left + mw > window.innerWidth - 16) left = Math.max(16, window.innerWidth - mw - 16);
      if(top + 100 > window.innerHeight){ top = rect.top - 10; modal.style.maxHeight = "60vh"; }
      modal.style.left = left + "px";
      modal.style.top = top + "px";
    } else {
      modal.style.left = "50%";
      modal.style.top = "50%";
      modal.style.transform = "translate(-50%,-50%)";
    }
    const saved = localStorage.getItem("sub_session");
    if(saved){
      try {
        const s = JSON.parse(saved);
        if(s.email && s.name){
          refreshSession().then(fresh => {
            if(fresh) updateNavAvatar(fresh);
            try { showPmInfo(fresh || s); } catch(e){ showPmLogin(); }
          });
          return;
        }
      } catch(e){}
    }
    updateNavAvatar(null);
    showPmLogin();
  };

  window.closeProfileModal = function(e){
    if(e && e.target !== e.currentTarget) return;
    const modal = id("profileModal");
    if(modal) modal.style.display = "none";
  };

  function id(el){ return document.getElementById(el); }

  /* avatar preview in edit mode */
  document.addEventListener("input", function(e){
    if(e.target && e.target.id === "pmAvatarImg"){
      const av = id("pmAvatarEdit");
      if(!av) return;
      const val = e.target.value.trim();
      if(val) av.style.background = "transparent url('" + val.replace(/'/g, "%27") + "') center/cover";
      else if(_pmData && _pmData.avatar) av.style.background = "transparent url('" + _pmData.avatar.replace(/'/g, "%27") + "') center/cover";
      else av.style.background = "";
    }
  });
  /* file upload → base64 data URL */
  document.addEventListener("change", function(e){
    if(e.target && e.target.id === "pmAvatarFile" && e.target.files && e.target.files[0]){
      const reader = new FileReader();
      reader.onload = function(ev){
        const dataUrl = ev.target.result;
        const img = id("pmAvatarImg");
        if(img) img.value = dataUrl;
        const av = id("pmAvatarEdit");
        if(av) av.style.backgroundImage = "url('" + dataUrl.replace(/'/g, "%27") + "')";
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  function showPmLogin(){
    const e = id("pmLogin"); if(e) e.style.display = "block";
    const f = id("pmForgot"); if(f) f.style.display = "none";
    const r = id("pmReset"); if(r) r.style.display = "none";
    const i = id("pmInfo"); if(i) i.style.display = "none";
    const s = id("pmSignup"); if(s) s.style.display = "none";
    const em = id("pmEmail"); if(em) em.value = "";
    const pw = id("pmPass"); if(pw) pw.value = "";
    const m = id("pmLoginMsg"); if(m) m.style.display = "none";
  }

  window.showPmForgot = function(){
    const e = id("pmLogin"); if(e) e.style.display = "none";
    const f = id("pmForgot"); if(f) f.style.display = "block";
    const r = id("pmReset"); if(r) r.style.display = "none";
    const i = id("pmInfo"); if(i) i.style.display = "none";
    const fe = id("pmForgotEmail"); if(fe) fe.value = "";
    const fm = id("pmForgotMsg"); if(fm) fm.style.display = "none";
  };

  window.showPmSignup = function(){
    const e = id("pmLogin"); if(e) e.style.display = "none";
    const f = id("pmForgot"); if(f) f.style.display = "none";
    const r = id("pmReset"); if(r) r.style.display = "none";
    const i = id("pmInfo"); if(i) i.style.display = "none";
    const s = id("pmSignup"); if(s) { s.style.display = "block"; s.querySelectorAll("input").forEach(inp => inp.value = ""); }
    const m = id("pmSignupMsg"); if(m) m.style.display = "none";
  };

  window.pmSignup = async function(){
    const name = id("pmRegName"); if(!name){ return; }
    const phone = id("pmRegPhone");
    const email = id("pmRegEmail");
    const pass = id("pmRegPass");
    const conf = id("pmRegConf");
    const msg = id("pmSignupMsg"); if(!msg) return;
    if(!name.value.trim() || !email.value.trim() || !pass.value.trim()){
      msg.textContent = "নাম, ইমেইল ও পাসওয়ার্ড আবশ্যক"; msg.style.display="block"; msg.style.color="#c1131d"; return;
    }
    if(pass.value.length < 4){
      msg.textContent = "পাসওয়ার্ড ন্যূনতম ৪ অক্ষর হতে হবে"; msg.style.display="block"; msg.style.color="#c1131d"; return;
    }
    if(pass.value !== conf.value){
      msg.textContent = "পাসওয়ার্ড মেলেনি"; msg.style.display="block"; msg.style.color="#c1131d"; return;
    }
    msg.textContent = "নিবন্ধন হচ্ছে..."; msg.style.display="block"; msg.style.color="#888";
    try{
      const r = await fetch("/api/subscribe", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          name: name.value.trim(),
          phone: phone.value.trim(),
          email: email.value.trim(),
          password: pass.value
        })
      });
      const d = await r.json();
      if(!r.ok){ msg.textContent = d.error||"নিবন্ধন ব্যর্থ হয়েছে"; msg.style.display="block"; msg.style.color="#c1131d"; return; }
      msg.textContent = "নিবন্ধন সফল! লগইন করা হচ্ছে..."; msg.style.display="block"; msg.style.color="#1b8c3a";
      if(d.token && d.subscriber){
        const s = d.subscriber;
        const sess = { email: s.email, name: s.name, phone: s.phone||"", active: s.active, address: s.address||"", avatar: s.avatar||"" };
        localStorage.setItem("sub_session", JSON.stringify(sess));
        updateNavAvatar(sess);
        showPmInfo(s);
      } else {
        id("pmEmail").value = email.value.trim();
        id("pmPass").value = pass.value;
        showPmLogin();
      }
    } catch(e){
      msg.textContent = "নেটওয়ার্ক ত্রুটি"; msg.style.display="block"; msg.style.color="#c1131d";
    }
  };

  window.pmSendResetCode = async function(){
    const email = id("pmForgotEmail");
    const msg = id("pmForgotMsg");
    if(!email || !email.value.trim()){ if(msg){ msg.textContent = "ইমেইল লিখুন"; msg.style.display="block"; } return; }
    msg.textContent = "কোড পাঠানো হচ্ছে...";
    msg.style.display = "block";
    msg.style.color = "#888";
    try {
      const r = await fetch("/api/subscriber/forgot-password", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email: email.value.trim() })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Failed");
      msg.textContent = "✅ " + (j.message || "কোড পাঠানো হয়েছে") + " (কোড: " + j.token + ")";
      msg.style.color = "#1b8c3a";
      msg.style.display = "block";
      const rc = id("pmResetCode"); if(rc){ rc.value = j.token; rc.focus(); }
      window._resetEmail = email.value.trim();
      const eL = id("pmLogin"); if(eL) eL.style.display = "none";
      const eF = id("pmForgot"); if(eF) eF.style.display = "none";
      const eR = id("pmReset"); if(eR) eR.style.display = "block";
    } catch(err) {
      msg.textContent = "❌ " + err.message;
      msg.style.color = "#c1131d";
      msg.style.display = "block";
    }
  };

  window.pmResetPassword = async function(){
    const code = id("pmResetCode");
    const np = id("pmResetPass");
    const cp = id("pmResetConf");
    const msg = id("pmResetMsg");
    if(!code || !code.value.trim()){ if(msg){ msg.textContent = "রিসেট কোড দিন"; msg.style.display="block"; } return; }
    if(!np || !np.value || np.value.length < 4){ if(msg){ msg.textContent = "নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষর"; msg.style.display="block"; } return; }
    if(!cp || np.value !== cp.value){ if(msg){ msg.textContent = "পাসওয়ার্ড দুটি মিলছে না"; msg.style.display="block"; } return; }
    msg.textContent = "রিসেট হচ্ছে...";
    msg.style.display = "block";
    msg.style.color = "#888";
    const email = window._resetEmail || "";
    if(!email){ msg.textContent = "❌ ইমেইল পাওয়া যায়নি, আবার চেষ্টা করুন"; msg.style.color="#c1131d"; return; }
    try {
      const r = await fetch("/api/subscriber/reset-password", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email, token: code.value.trim(), new_password: np.value })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Failed");
      msg.textContent = "✅ " + (j.message || "পাসওয়ার্ড রিসেট সফল!");
      msg.style.color = "#1b8c3a";
      msg.style.display = "block";
      const em = id("pmEmail"); if(em) em.value = email;
      const pw = id("pmPass"); if(pw) pw.value = np.value;
      setTimeout(() => showPmLogin(), 1500);
    } catch(err) {
      msg.textContent = "❌ " + err.message;
      msg.style.color = "#c1131d";
      msg.style.display = "block";
    }
  };

    let _pmData = null;

  function showPmInfo(s){
    _pmData = s;
    const eL = id("pmLogin"); if(eL) eL.style.display = "none";
    const eF = id("pmForgot"); if(eF) eF.style.display = "none";
    const eR = id("pmReset"); if(eR) eR.style.display = "none";
    const eI = id("pmInfo"); if(eI) eI.style.display = "block";
    /* avatar */
    const av = id("pmAvatar");
    if(av){
      if(s.avatar){ av.textContent = ""; av.style.background = "transparent url('" + s.avatar.replace(/'/g, "%27") + "') center/cover"; }
      else { av.textContent = (s.name || "U")[0].toUpperCase(); av.style.backgroundImage = ""; }
    }
    const avImg = id("pmAvatarImg"); if(avImg) avImg.value = s.avatar || "";
    const avFile = id("pmAvatarFile"); if(avFile) avFile.value = "";
    /* name */
    const nm = id("pmName"); if(nm) nm.textContent = esc(s.name);
    const en = id("pmEditName"); if(en) en.value = s.name || "";
    /* phone */
    const ph = id("pmPhone"); if(ph) ph.textContent = esc(s.phone);
    const ep = id("pmEditPhone"); if(ep) ep.value = s.phone || "";
    /* email */
    const em = id("pmInfoEmail"); if(em) em.textContent = esc(s.email);
    /* address */
    const ad = id("pmAddress"); if(ad) ad.textContent = esc(s.address) || "–";
    const ea = id("pmEditAddress"); if(ea) ea.value = s.address || "";
    /* badge */
    const badge = id("pmBadge");
    if(badge){
      if (s.is_admin) {
        badge.textContent = "অ্যাডমিন";
        badge.className = "pm-badge admin";
      } else if(s.active){
        badge.textContent = "সক্রিয়";
        badge.className = "pm-badge yes";
      } else {
        badge.textContent = "নিষ্ক্রিয়";
        badge.className = "pm-badge no";
      }
    }
    const cp = id("pmCurPass"); if(cp) cp.value = "";
    const np = id("pmNewPass"); if(np) np.value = "";
    const cf = id("pmConfPass"); if(cf) cf.value = "";
    const im = id("pmInfoMsg"); if(im) im.style.display = "none";
    cancelPmEdit();
  }

  window.togglePmEdit = function(){
    const ei = id("pmEditInfo"); if(ei) ei.style.display = "block";
    const vi = id("pmViewInfo"); if(vi) vi.style.display = "none";
    const eb = id("pmEditBtn"); if(eb) eb.style.display = "none";
    const sb = id("pmSaveBtn"); if(sb) sb.style.display = "";
    const cb = id("pmCancelBtn"); if(cb) cb.style.display = "";
    const im = id("pmInfoMsg"); if(im) im.style.display = "none";
  };

  window.cancelPmEdit = function(){
    const ei = id("pmEditInfo"); if(ei) ei.style.display = "none";
    const vi = id("pmViewInfo"); if(vi) vi.style.display = "block";
    const eb = id("pmEditBtn"); if(eb) eb.style.display = "";
    const sb = id("pmSaveBtn"); if(sb) sb.style.display = "none";
    const cb = id("pmCancelBtn"); if(cb) cb.style.display = "none";
    const en = id("pmEditName"); if(en) en.value = (_pmData && _pmData.name) || "";
    const ep = id("pmEditPhone"); if(ep) ep.value = (_pmData && _pmData.phone) || "";
    const ea = id("pmEditAddress"); if(ea) ea.value = (_pmData && _pmData.address) || "";
    const ai = id("pmAvatarImg"); if(ai) ai.value = (_pmData && _pmData.avatar) || "";
    const af = id("pmAvatarFile"); if(af) af.value = "";
  };

  window.pmSaveProfile = async function(){
    const en = id("pmEditName");
    const ep = id("pmEditPhone");
    const ea = id("pmEditAddress");
    const ai = id("pmAvatarImg");
    const msg = id("pmInfoMsg");
    if(!en || !en.value.trim()){ if(msg){ msg.textContent = "নাম লিখুন"; msg.style.display="block"; } return; }
    if(!_pmData || !_pmData.email) return;
    const pw = prompt("পরিবর্তন নিশ্চিত করতে আপনার পাসওয়ার্ড দিন:");
    if(!pw) return;
    msg.textContent = "সংরক্ষণ হচ্ছে...";
    msg.style.display = "block";
    msg.style.color = "#888";
    try {
      const r = await fetch("/api/subscriber/profile", {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          email: _pmData.email, password: pw,
          name: en.value.trim(),
          phone: ep ? ep.value : "",
          address: ea ? ea.value : "",
          avatar: ai ? ai.value : ""
        })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Failed");
      const s = j.subscriber;
      s.is_admin = _pmData.is_admin || false;
      _pmData = s;
      const sess = { email: s.email, name: s.name, phone: s.phone || "", active: s.active, address: s.address || "", avatar: s.avatar || "" };
      if (s.is_admin) sess.is_admin = true;
      localStorage.setItem("sub_session", JSON.stringify(sess));
      updateNavAvatar(sess);
      showPmInfo(s);
      msg.textContent = "✅ প্রোফাইল আপডেট হয়েছে!";
      msg.style.color = "#1b8c3a";
      msg.style.display = "block";
    } catch(err) {
      msg.textContent = "❌ " + err.message;
      msg.style.color = "#c1131d";
      msg.style.display = "block";
    }
  };

  window.pmLogin = async function(){
    const email = id("pmEmail");
    const pass = id("pmPass");
    const msg = id("pmLoginMsg");
    if(!email || !email.value.trim()){ if(msg){ msg.textContent = "ইমেইল লিখুন"; msg.style.display="block"; } return; }
    if(!pass || !pass.value){ if(msg){ msg.textContent = "পাসওয়ার্ড লিখুন"; msg.style.display="block"; } return; }
    msg.textContent = "লগইন হচ্ছে...";
    msg.style.display = "block";
    msg.style.color = "#888";
    try {
      const r = await fetch("/api/subscriber/login", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email: email.value.trim(), password: pass.value })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Login failed");
      const s = j.subscriber;
      const sess = { email: s.email, name: s.name, phone: s.phone || "", active: s.active, address: s.address || "", avatar: s.avatar || "" };
      if (s.is_admin) sess.is_admin = true;
      localStorage.setItem("sub_session", JSON.stringify(sess));
      updateNavAvatar(sess);
      try { showPmInfo(s); } catch(e) { showPmLogin(); }
    } catch(err) {
      msg.textContent = "❌ " + err.message;
      msg.style.color = "#c1131d";
      msg.style.display = "block";
    }
  };

  window.pmLogout = function(){
    localStorage.removeItem("sub_session");
    updateNavAvatar(null);
    showPmLogin();
  };

  window.pmChangePass = async function(){
    const saved = localStorage.getItem("sub_session");
    if(!saved) return;
    const s = JSON.parse(saved);
    const cur = id("pmCurPass");
    const np = id("pmNewPass");
    const cp = id("pmConfPass");
    const msg = id("pmInfoMsg");
    if(!cur || !cur.value){ if(msg){ msg.textContent = "বর্তমান পাসওয়ার্ড দিন"; msg.style.display="block"; } return; }
    if(!np || !np.value || np.value.length < 4){ if(msg){ msg.textContent = "নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষর"; msg.style.display="block"; } return; }
    if(!cp || np.value !== cp.value){ if(msg){ msg.textContent = "নতুন পাসওয়ার্ড দুটি মিলছে না"; msg.style.display="block"; } return; }
    msg.textContent = "পরিবর্তন হচ্ছে...";
    msg.style.display = "block";
    msg.style.color = "#888";
    try {
      const r = await fetch("/api/subscriber/password", {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email: s.email, current_password: cur.value, new_password: np.value })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Failed");
      msg.textContent = "✅ পাসওয়ার্ড পরিবর্তন সফল!";
      msg.style.color = "#1b8c3a";
      msg.style.display = "block";
      cur.value = ""; np.value = ""; cp.value = "";
    } catch(err) {
      msg.textContent = "❌ " + err.message;
      msg.style.color = "#c1131d";
      msg.style.display = "block";
    }
  };

})();
