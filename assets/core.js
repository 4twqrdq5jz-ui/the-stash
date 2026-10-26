/* The Stash: shared code used by every page */
(function(){
"use strict";
const CFG = window.STASH_CONFIG || {};
const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/YOUR_/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));
const sb = (configured && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PALETTE = ["#FFC83D","#FF8FB1","#7CCBF2","#9AD98A","#C2A8FF","#FFB27A"];
function colorFor(s){ s = String(s || "x"); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
const initials = s => esc((String(s || "?").trim()[0] || "?").toUpperCase());
function timeAgo(t){
  const ms = typeof t === "string" ? Date.parse(t) : t; if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  for (const [n, u] of [[31536000,"year"],[2592000,"month"],[604800,"week"],[86400,"day"],[3600,"hour"],[60,"minute"]]){ if (s >= n){ const k = Math.floor(s / n); return k + " " + u + (k > 1 ? "s" : "") + " ago"; } }
  return "just now";
}
function fmtDur(sec){ sec = Math.round(+sec || 0); if (!sec) return ""; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2,"0") : m) + ":" + String(s).padStart(2,"0"); }
function fmtCount(n){ n = +n || 0; if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,"") + "M"; if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,"") + "K"; return String(n); }
const plural = (n, w) => fmtCount(n) + " " + w + (+n === 1 ? "" : "s");
function safeUrl(u){
  u = String(u || "").trim(); if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol) || !x.hostname.includes(".")) return ""; return x.href; } catch(e){ return ""; }
}
function safeNext(n){ n = String(n || ""); return (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login")) ? n : "/"; }
const param = k => new URLSearchParams(location.search).get(k);
const pub = (bucket, path) => (sb && path) ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : "";
const USER_RE = /^[a-z0-9_][a-z0-9_.]{2,23}$/;
function must(res){ if (res && res.error) throw res.error; return res ? res.data : null; }
function errText(e, fallback){
  const m = (e && (e.message || e.error_description)) || "";
  if (e && e.code === "23505") return "That's already taken.";
  if (e && e.code === "P0001" && m) return m;
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Couldn't reach The Stash. Check your connection and try again.";
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return "That file is larger than the upload limit.";
  if (/mime type|not supported/i.test(m)) return "That file type isn't supported.";
  return fallback || m || "Something went wrong. Try again.";
}

let toastTimer = null;
function toast(msg){ const r = $("#toastRoot"); if (!r) return; r.innerHTML = '<div class="toast" role="status">' + esc(msg) + '</div>'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { r.innerHTML = ""; }, 3400); }

/* ---------- modal ---------- */
let modalClose = null, lastFocus = null;
function openModal(html, onMount, opts){
  opts = opts || {};
  const root = $("#modalRoot"); lastFocus = document.activeElement;
  root.innerHTML = '<div class="modal-bg" data-bg="1"><div class="modal ' + (opts.cls || "") + '" role="dialog" aria-modal="true">' + html + '</div></div>';
  modalClose = opts.onClose || null;
  const m = root.querySelector(".modal");
  if (onMount) onMount(m);
  const f = m.querySelector("input:not([type=file]):not([type=checkbox]), textarea, .primary");
  if (f) setTimeout(() => f.focus(), 30);
  return m;
}
function closeModal(){ const fn = modalClose; modalClose = null; const r = $("#modalRoot"); if (r) r.innerHTML = ""; if (fn) fn(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
const modalOpen = () => { const r = $("#modalRoot"); return !!(r && r.firstChild); };
function confirmModal(title, body, label, fn){
  openModal('<h2>' + esc(title) + '</h2><p class="lede">' + esc(body) + '</p><div class="err" id="cfErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="cfGo">' + esc(label) + '</button></div>', m => {
    $("#cfGo", m).addEventListener("click", async () => { const b = $("#cfGo", m); b.disabled = true; try { await fn(); closeModal(); } catch(e){ $("#cfErr", m).textContent = errText(e); b.disabled = false; } });
  });
}
document.addEventListener("click", e => {
  if (e.target.dataset && e.target.dataset.bg){ closeModal(); return; }
  if (e.target.closest("[data-close]")){ e.preventDefault(); closeModal(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && modalOpen()) closeModal(); });

/* ---------- session ---------- */
const App = { sb, configured, cfg: CFG, session: null, user: null, profile: null, managed: [], ready: null };
async function loadMyProfile(){
  App.profile = null; App.managed = [];
  if (!App.user) return null;
  const [mine, man] = await Promise.all([
    sb.from("profiles").select("*").eq("user_id", App.user.id).maybeSingle(),
    sb.from("profiles").select("*").eq("manager_id", App.user.id).order("created_at")
  ]);
  App.profile = mine.data || null;
  App.managed = (man.data || []).filter(p => p.kind === "channel");
  return App.profile;
}
App.ready = (async () => {
  if (!sb) return;
  try {
    const { data } = await sb.auth.getSession();
    App.session = data.session; App.user = data.session ? data.session.user : null;
    await loadMyProfile();
  } catch(e){}
})();
App.signedIn = () => !!(App.user && App.profile);
App.manages = id => !!(App.user && ((App.profile && App.profile.id === id && App.profile.manager_id === App.user.id) || App.managed.some(c => c.id === id)));
App.isFounder = () => !!(App.profile && App.profile.is_founder);
App.postAs = () => { const list = App.profile ? [App.profile] : []; App.managed.forEach(c => { if (!list.some(x => x.id === c.id)) list.push(c); }); return list; };
App.channelRequestUrl = (what) => {
  const to = CFG.SUPPORT_EMAIL || "support@thestash.gay", u = App.profile ? "@" + App.profile.username : "";
  const subject = what === "convert" ? "Turn my profile into a channel" : "New channel request";
  const body = what === "convert"
    ? "Hi Stash support,\n\nPlease turn my profile " + u + " into a channel.\n\nWhat the channel is about:\n\n"
    : "Hi Stash support,\n\nI'd like a new channel run by my account " + u + ".\n\nChannel username I'd like:\nChannel name:\nWhat the channel is about:\n\n";
  return "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
};
App.reloadProfile = async () => { await loadMyProfile(); renderHeader(); };

/* ---------- avatars & cards ---------- */
function avatar(p, size){
  const key = p ? p.id : "x", name = p ? (p.display_name || p.username) : "?";
  const st = 'style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .42) + 'px;background:' + colorFor(key) + '"';
  if (p && p.avatar_path) return '<span class="av" ' + st + '><img src="' + esc(pub("images", p.avatar_path)) + '" alt=""></span>';
  return '<span class="av" ' + st + ' aria-hidden="true">' + initials(name) + '</span>';
}
/* ---------- anniversaries ---------- */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ordinal(n){ const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function anniversary(created, now){
  const d = new Date(created); now = now || new Date();
  if (isNaN(d)) return { years: 0, today: false, days: 0, joined: "" };
  let years = now.getFullYear() - d.getFullYear();
  const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  let m = d.getMonth(), day = d.getDate();
  if (m === 1 && day === 29 && !leap(now.getFullYear())) day = 28;
  const beforeThisYear = now.getMonth() < m || (now.getMonth() === m && now.getDate() < day);
  if (beforeThisYear) years--;
  const today = years >= 1 && now.getMonth() === m && now.getDate() === day;
  const days = Math.max(0, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000));
  return { years: Math.max(0, years), today, days, joined: MONTHS[d.getMonth()] + " " + d.getFullYear(), joinedFull: MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() };
}
function badges(p){
  if (!p) return "";
  const a = p.created_at ? anniversary(p.created_at) : null;
  return (a && a.today ? '<span class="badge anniv" title="' + ordinal(a.years) + ' Stash anniversary today">🎂 ' + a.years + (a.years === 1 ? " year" : " years") + '</span>' : "") + (p.is_founder ? '<span class="badge founder" title="Founding account">Founder</span>' : "") + (p.kind === "channel" ? '<span class="badge channel">Channel</span>' : "");
}
const displayName = p => p ? (p.display_name || p.username || "Unknown") : "Unknown";
function chAvatar(c, size){ return '<span class="chav" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .45) + 'px;background:' + colorFor(c ? c.id : "x") + '" aria-hidden="true">' + initials(c ? c.name : "?") + '</span>'; }
function thumbInner(v){ return v.thumb_path ? '<img src="' + esc(pub("images", v.thumb_path)) + '" alt="" loading="lazy">' : '<span class="ph" style="background:' + colorFor(v.owner_id) + '">▶</span>'; }
const watchUrl = (id, list) => "/watch/?v=" + encodeURIComponent(id) + (list ? "&list=" + encodeURIComponent(list) : "");
const profileUrl = p => "/profile/?u=" + encodeURIComponent(p ? p.username : "");
function vcard(v, maps, opts){
  opts = opts || {};
  const o = maps.profiles.get(v.owner_id), ohref = o ? esc(profileUrl(o)) : "#";
  const href = esc(watchUrl(v.id, opts.list));
  return '<article class="vcard"><a class="thumb" href="' + href + '" aria-label="Play ' + esc(v.title) + '">' + thumbInner(v) + (v.duration ? '<span class="dur">' + fmtDur(v.duration) + '</span>' : "") + '</a>' +
    '<div class="vmeta">' + (opts.compact ? "" : '<a href="' + ohref + '" aria-label="' + esc(displayName(o)) + '">' + avatar(o, 36) + '</a>') +
    '<div style="min-width:0"><a class="vtitle" href="' + href + '">' + esc(v.title) + '</a><a class="vsub" href="' + ohref + '">' + esc(displayName(o)) + '</a>' +
    '<div class="vsmall">' + (v.like_count ? plural(v.like_count, "like") + ", " : "") + esc(timeAgo(v.created_at)) + '</div></div></div></article>';
}
const PROFILE_COLS = "id,username,display_name,avatar_path,kind,is_founder,user_id,manager_id,created_at";
async function profilesByIds(ids){
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await sb.from("profiles").select(PROFILE_COLS).in("id", ids.slice(0, 300));
  return new Map((data || []).map(x => [x.id, x]));
}
async function hydrate(videos){ return { profiles: await profilesByIds(videos.map(v => v.owner_id)) }; }
async function videosByIds(ids){
  if (!ids.length) return [];
  const rows = must(await sb.from("video_feed").select("*").in("id", ids.slice(0, 300))) || [];
  const m = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => m.get(id)).filter(Boolean);
}

/* ---------- banners ---------- */
function rng(seed){ let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const BANNER_W = 1800, BANNER_H = 450;
const BANNERS = {
  tapes: { name: "Tape shelf", draw(r){ let o = '<rect width="1800" height="450" fill="#141A33"/>'; const pal = ["#FFC83D","#FF8FB1","#7CCBF2","#9AD98A","#C2A8FF","#FFB27A","#2A3366","#343E78"];
    for (let row = 0; row < 3; row++){ let x = -10; const base = 140 + row * 150; while (x < 1800){ const w = 40 + Math.floor(r() * 18), h = 100 + Math.floor(r() * 25), c = pal[Math.floor(r() * pal.length)];
      o += '<rect x="' + x + '" y="' + (base - h) + '" width="' + w + '" height="' + h + '" rx="4" fill="' + c + '"/><rect x="' + (x + 7) + '" y="' + (base - h + 12) + '" width="' + (w - 14) + '" height="' + (h - 40) + '" rx="3" fill="#F4F1E6" opacity=".8"/>'; x += w + 4; }
      o += '<rect x="0" y="' + base + '" width="1800" height="12" fill="#0B0F22"/>'; } return o; } },
  sunset: { name: "Sunset bands", draw(){ const c = ["#2B1E5C","#5B2A86","#A23B72","#E2587A","#F28A5B","#FFC83D"]; return c.map((col, i) => '<rect y="' + (i * 75) + '" width="1800" height="76" fill="' + col + '"/>').join("") + '<circle cx="1350" cy="450" r="170" fill="#FFE39A" opacity=".9"/>'; } },
  confetti: { name: "Confetti", draw(r){ let o = '<rect width="1800" height="450" fill="#1A2140"/>'; const pal = ["#FFC83D","#FF8FB1","#7CCBF2","#9AD98A","#C2A8FF","#FFB27A"];
    for (let i = 0; i < 170; i++){ const x = r() * 1800, y = r() * 450, c = pal[Math.floor(r() * 6)], k = r();
      o += k < .4 ? '<circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="' + (4 + r() * 9).toFixed(1) + '" fill="' + c + '"/>' : '<rect x="' + x.toFixed(0) + '" y="' + y.toFixed(0) + '" width="' + (8 + r() * 18).toFixed(0) + '" height="6" rx="3" fill="' + c + '" transform="rotate(' + (r() * 180).toFixed(0) + ' ' + x.toFixed(0) + ' ' + y.toFixed(0) + ')"/>'; } return o; } },
  grid: { name: "Night grid", draw(){ let o = '<rect width="1800" height="450" fill="#11162A"/>'; for (let x = 0; x <= 1800; x += 60) o += '<path d="M' + x + ' 0V450" stroke="#2F3864" stroke-width="2"/>'; for (let y = 0; y <= 450; y += 60) o += '<path d="M0 ' + y + 'H1800" stroke="#2F3864" stroke-width="2"/>';
    return o + '<path d="M0 330 L300 250 L600 290 L900 170 L1200 220 L1500 110 L1800 150" fill="none" stroke="#FFC83D" stroke-width="8" stroke-linejoin="round"/>'; } },
  waves: { name: "Waves", draw(){ const c = ["#7CCBF2","#4F9FD6","#2F6FB0","#1E4A86","#14305E"]; let o = '<rect width="1800" height="450" fill="#BFE6FA"/>';
    c.forEach((col, i) => { const y = 120 + i * 70, a = 30 + i * 6; let d = "M0 " + y; for (let x = 0; x <= 1800; x += 150) d += " Q" + (x + 75) + " " + (y + (i % 2 ? a : -a)) + " " + (x + 150) + " " + y; o += '<path d="' + d + ' V450 H0 Z" fill="' + col + '"/>'; }); return o; } },
  stars: { name: "Starry night", draw(r){ let o = '<defs><radialGradient id="g" cx=".7" cy="1" r="1"><stop offset="0" stop-color="#5B2A86"/><stop offset="1" stop-color="#0B0F22"/></radialGradient></defs><rect width="1800" height="450" fill="url(#g)"/>';
    for (let i = 0; i < 220; i++) o += '<circle cx="' + (r() * 1800).toFixed(0) + '" cy="' + (r() * 450).toFixed(0) + '" r="' + (r() * 2.4 + .4).toFixed(1) + '" fill="#fff" opacity="' + (r() * .7 + .3).toFixed(2) + '"/>';
    return o + '<circle cx="300" cy="120" r="55" fill="#FFF2C4"/><circle cx="322" cy="104" r="50" fill="#1B1640"/>'; } },
  checker: { name: "Checkerboard", draw(){ let o = '<rect width="1800" height="450" fill="#FF8FB1"/>'; for (let y = 0; y < 450; y += 75) for (let x = 0; x < 1800; x += 75) if (((x + y) / 75) % 2 === 0) o += '<rect x="' + x + '" y="' + y + '" width="75" height="75" fill="#FFC83D"/>'; return o; } },
  bloom: { name: "Bloom", draw(r){ let o = '<rect width="1800" height="450" fill="#F2F4FA"/>'; const pal = ["#FFC83D","#FF8FB1","#7CCBF2","#9AD98A","#C2A8FF","#FFB27A"];
    for (let i = 0; i < 16; i++) o += '<circle cx="' + (r() * 1800).toFixed(0) + '" cy="' + (r() * 450).toFixed(0) + '" r="' + (80 + r() * 160).toFixed(0) + '" fill="' + pal[i % 6] + '" opacity=".75" style="mix-blend-mode:multiply"/>'; return o; } }
};
const bannerCache = {};
function presetUrl(id){
  if (!BANNERS[id]) return "";
  if (!bannerCache[id]){ let seed = 0; for (const ch of id) seed = seed * 31 + ch.charCodeAt(0);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + BANNER_W + ' ' + BANNER_H + '" preserveAspectRatio="xMidYMid slice">' + BANNERS[id].draw(rng(seed)) + '</svg>';
    bannerCache[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  return bannerCache[id];
}
function bannerHTML(p){
  if (p && p.banner_path) return '<img src="' + esc(pub("images", p.banner_path)) + '" alt="">';
  if (p && p.banner_preset && BANNERS[p.banner_preset]) return '<img src="' + presetUrl(p.banner_preset) + '" alt="">';
  return '<div style="width:100%;height:100%;background:linear-gradient(120deg,' + colorFor(p ? p.id : "x") + ',var(--surface-2))"></div>';
}

/* ---------- header & nav ---------- */
const IC = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z"/></svg>',
  subs: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M7 3.5h10M10 11v6l5-3z"/></svg>',
  lib: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 11h11M4 16h7"/><path d="M17 14v7l4-3.5z" fill="currentColor"/></svg>',
  up: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  me: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.5-4 4.3-5.5 7.5-5.5s6 1.5 7.5 5.5"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
};
let menuOpen = false;
function navLink(page, href, label, icon){ const cur = document.body.dataset.page === page; return '<a href="' + href + '" class="' + (cur ? "cur" : "") + '"' + (cur ? ' aria-current="page"' : "") + '>' + icon + '<span>' + label + '</span></a>'; }
function renderHeader(){
  const top = $("#top"); if (!top) return;
  const page = document.body.dataset.page;
  if (!top.dataset.built){
    top.dataset.built = "1";
    const drawerMode = page === "watch";
    if (drawerMode) document.body.classList.add("drawer-mode");
    top.innerHTML = (drawerMode ? '<button class="iconbtn hamb" id="hamb" aria-label="Open menu" aria-expanded="false" aria-controls="drawer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' : "") +
      '<a class="wordmark" href="/" aria-label="The Stash home">the stash</a><div class="spacer show-sm"></div>' +
      '<form class="search" id="searchBox" role="search" action="/search/" method="get"><input name="q" type="search" placeholder="Search videos, channels and people" aria-label="Search" autocomplete="off" value="' + esc(page === "search" ? (param("q") || "") : "") + '"><button aria-label="Search">' + IC.search + '</button></form>' +
      '<div class="top-actions"><button class="iconbtn show-sm" id="searchToggle" aria-label="Open search">' + IC.search + '</button>' +
      '<a class="btn ghost hide-sm" href="/upload/"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Upload</a><div class="menuwrap" id="acct"></div></div>';
    if (drawerMode){
      const dr = document.createElement("div"); dr.id = "drawerRoot"; dr.innerHTML = '<div class="drawer-bg" id="drawerBg" hidden></div><nav class="drawer" id="drawer" aria-label="Main" hidden><div class="drawer-head"><button class="iconbtn" id="drawerX" aria-label="Close menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><a class="wordmark" href="/">the stash</a></div><div id="drawerNav"></div></nav>';
      document.body.appendChild(dr);
      const open = on => { $("#drawer").hidden = !on; $("#drawerBg").hidden = !on; $("#hamb").setAttribute("aria-expanded", String(on)); document.body.classList.toggle("drawer-open", on); if (on) { const f = $("#drawerNav a"); if (f) f.focus(); } else $("#hamb").focus(); };
      $("#hamb").addEventListener("click", () => open($("#drawer").hidden));
      $("#drawerX").addEventListener("click", () => open(false));
      $("#drawerBg").addEventListener("click", () => open(false));
      document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) open(false); });
    }
    $("#searchToggle").addEventListener("click", () => { const s = $("#searchBox"); s.classList.toggle("open"); if (s.classList.contains("open")) s.querySelector("input").focus(); });
    $("#searchBox").addEventListener("submit", e => { if (!e.target.q.value.trim()) e.preventDefault(); });
    document.addEventListener("click", e => {
      if (menuOpen && e.target.isConnected && !e.target.closest("#acct")){ menuOpen = false; renderHeader(); }
      const a = e.target.closest("[data-auth]"); if (a){ e.preventDefault(); openAuthModal(a.dataset.auth); }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && menuOpen){ menuOpen = false; renderHeader(); } });
  }
  const acct = $("#acct"), p = App.profile;
  if (!sb){ acct.innerHTML = ""; }
  else if (!App.user){ acct.innerHTML = '<div style="display:flex;gap:8px"><a class="btn ghost hide-sm" href="/login/" data-auth="signin">Sign in</a><a class="btn primary" href="/login/?mode=signup" data-auth="signup">Sign up</a></div>'; }
  else if (!p){ acct.innerHTML = '<a class="btn primary" href="/login/?next=' + encodeURIComponent(location.pathname + location.search) + '">Finish sign-up</a>'; }
  else {
    acct.innerHTML = '<button class="iconbtn" id="menuBtn" aria-label="Account menu" aria-expanded="' + menuOpen + '" style="width:40px;height:40px">' + avatar(p, 34) + '</button>' +
      (menuOpen ? '<div class="menu" role="menu"><div class="who">' + avatar(p, 38) + '<span style="min-width:0"><span class="name">' + esc(p.display_name || p.username) + '</span><span class="sub">@' + esc(p.username) + '</span></span></div>' +
      '<a role="menuitem" href="' + esc(profileUrl(p)) + '">Your profile</a><a role="menuitem" href="' + esc(profileUrl(p)) + '&edit=1">Edit profile</a><a role="menuitem" href="/library/">Library</a>' +
      (App.managed.filter(c => c.id !== p.id).length ? '<div class="menuhead">Your channels</div>' + App.managed.filter(c => c.id !== p.id).map(c => '<a role="menuitem" href="' + esc(profileUrl(c)) + '">' + esc(displayName(c)) + '</a>').join("") : "") +
      (p.kind === "channel" ? "" : '<a role="menuitem" href="' + esc(App.channelRequestUrl("new")) + '">Get a channel</a>') +
      (App.isFounder() ? '<a role="menuitem" href="#" id="supportTools">Support tools</a>' : "") +
      '<button role="menuitem" id="signOutBtn">Sign out</button></div>' : "");
    $("#menuBtn").addEventListener("click", () => { menuOpen = !menuOpen; renderHeader(); });
    const so = $("#signOutBtn"); if (so) so.addEventListener("click", async () => { await sb.auth.signOut(); location.href = "/"; });
    const st = $("#supportTools"); if (st) st.addEventListener("click", e => { e.preventDefault(); menuOpen = false; renderHeader(); if (App.openSupportTools) App.openSupportTools(); });
  }
  const side = $("#side");
  if (side){
    side.innerHTML = navLink("home","/","Home",IC.home) + navLink("subscriptions","/subscriptions/","Subscriptions",IC.subs) + navLink("library","/library/","Library",IC.lib) + navLink("upload","/upload/","Upload",IC.up) +
      (p ? navLink("me", profileUrl(p), "Your profile", IC.me) : "");
    const dn = $("#drawerNav"); if (dn) dn.innerHTML = side.innerHTML;
    $("#bottomnav").innerHTML = navLink("home","/","Home",IC.home) + navLink("subscriptions","/subscriptions/","Subscriptions",IC.subs) + navLink("upload","/upload/","Upload",IC.up) + navLink("library","/library/","Library",IC.lib) + (p ? navLink("me", profileUrl(p), "You", IC.me) : "");
  }
}

/* ---------- sign in / sign up ---------- */
const COMMON = ["password","password1","password123","12345678","123456789","1234567890","qwerty123","qwertyuiop","iloveyou","letmein123","welcome123","admin123","abc12345","thestash","11111111","00000000"];
function strength(pw){
  if (!pw) return { level: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 8 || /^(.)\1+$/.test(pw) || COMMON.includes(pw.toLowerCase())) s = Math.min(s, 1);
  const level = s <= 2 ? 1 : s === 3 ? 2 : 3;
  return { level, label: ["", "Weak", "Fair", "Strong"][level] };
}
function pwField(id, label, auto){
  return '<div class="field"><label for="' + id + '">' + label + '</label><div class="pw"><input class="input" id="' + id + '" type="password" autocomplete="' + auto + '" maxlength="72"><button type="button" class="eye" data-eye="' + id + '" aria-label="Show password">Show</button></div></div>';
}
function oauthButtons(label){
  return '<div class="oauth"><button type="button" data-oauth="google"><span class="mark" aria-hidden="true">G</span>Continue with Google</button><button type="button" data-oauth="x"><span class="mark" aria-hidden="true">X</span>Continue with X</button></div><div class="divider">' + (label || "or use email") + '</div>';
}
function mountAuth(root, opts){
  opts = opts || {};
  const next = safeNext(opts.next || location.pathname + location.search);
  const loginReturn = location.origin + "/login/?next=" + encodeURIComponent(next);
  let step = opts.mode || "signin";
  const wordmark = opts.full ? '<a class="wordmark" href="/" aria-label="The Stash home">the stash</a>' : "";
  function tabs(){ return '<div class="authtabs" role="tablist"><button type="button" role="tab" aria-selected="' + (step === "signin") + '" class="' + (step === "signin" ? "cur" : "") + '" data-step="signin">Sign in</button><button type="button" role="tab" aria-selected="' + (step === "signup") + '" class="' + (step === "signup" ? "cur" : "") + '" data-step="signup">Sign up</button></div>'; }
  function render(){
    let h = wordmark;
    if (step === "signin"){
      h += '<h2>Welcome back</h2><p class="lede">Sign in to upload, comment, like and follow.</p>' + tabs() + oauthButtons("or use your email or username") +
        '<div class="field"><label for="aEmail">Email or username</label><input class="input" id="aEmail" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" inputmode="email"></div>' + pwField("aPw", "Password", "current-password") +
        '<div style="text-align:right;margin-top:8px"><button type="button" class="linkish" data-step="forgot" style="font-size:13px">Forgot password?</button></div>' +
        '<div class="err" id="aErr" role="alert"></div><button class="btn primary submit" id="aGo">Sign in</button>' +
        '<p class="switch">New to The Stash? <button type="button" data-step="signup">Create an account</button></p>';
    } else if (step === "signup"){
      h += '<h2>Create your account</h2><p class="lede">Watching is free for everyone. An account lets you upload and join in.</p>' + tabs() + oauthButtons() +
        '<div class="field"><label for="aEmail">Email</label><input class="input" id="aEmail" type="email" autocomplete="email" inputmode="email"></div>' + pwField("aPw", "Password", "new-password") +
        '<div class="meter" id="aMeter" data-level="0" aria-hidden="true"><i></i><i></i><i></i></div><div class="meterlabel"><span id="aHint">Use at least 8 characters.</span><b id="aLevel" data-level="0"></b></div>' +
        pwField("aPw2", "Confirm password", "new-password") + '<div class="match" id="aMatch" aria-live="polite"></div>' +
        '<div class="err" id="aErr" role="alert"></div><button class="btn primary submit" id="aGo" disabled>Create account</button>' +
        '<p class="switch">Already have an account? <button type="button" data-step="signin">Sign in</button></p>';
    } else if (step === "check"){
      h += '<h2>Check your inbox</h2><p class="lede">We sent a confirmation link to <b>' + esc(root.dataset.email || "your email") + '</b>. Open it on this device to finish setting up your account.</p><div class="okbox vsmall">No email after a few minutes? Check your spam folder, or <button type="button" class="linkish" id="aResend">send it again</button>.</div><div class="err" id="aErr" role="alert"></div><p class="switch"><button type="button" data-step="signin">Back to sign in</button></p>';
    } else if (step === "forgot"){
      h += '<h2>Reset your password</h2><p class="lede">Enter the email on your account and we\'ll send you a link to choose a new password.</p><div class="field"><label for="aEmail">Email</label><input class="input" id="aEmail" type="email" autocomplete="email" value="' + esc(/@.+\./.test(root.dataset.email || "") ? root.dataset.email : "") + '"></div><div class="err" id="aErr" role="alert"></div><button class="btn primary submit" id="aGo">Send reset link</button><p class="switch"><button type="button" data-step="signin">Back to sign in</button></p>';
    } else if (step === "sent"){
      h += '<h2>Reset link sent</h2><p class="lede">If an account uses <b>' + esc(root.dataset.email || "that email") + '</b>, a link to reset the password is on its way.</p><p class="switch"><button type="button" data-step="signin">Back to sign in</button></p>';
    } else if (step === "reset"){
      h += '<h2>Choose a new password</h2><p class="lede">Pick a password you don\'t use anywhere else.</p>' + pwField("aPw", "New password", "new-password") +
        '<div class="meter" id="aMeter" data-level="0" aria-hidden="true"><i></i><i></i><i></i></div><div class="meterlabel"><span id="aHint">Use at least 8 characters.</span><b id="aLevel" data-level="0"></b></div>' +
        pwField("aPw2", "Confirm new password", "new-password") + '<div class="match" id="aMatch" aria-live="polite"></div><div class="err" id="aErr" role="alert"></div><button class="btn primary submit" id="aGo" disabled>Save new password</button>';
    } else if (step === "username"){
      h += '<h2>Pick your username</h2><p class="lede">This is how people find and mention you. You can change it later.</p>' +
        '<div class="field"><label for="aUser">Username <span class="hint">3 to 24 characters: letters, numbers, _ and .</span></label><input class="input" id="aUser" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false"></div>' +
        '<div class="field"><label for="aName">Profile name</label><input class="input" id="aName" maxlength="50" autocomplete="name"></div>' +
        '<div class="err" id="aErr" role="alert"></div><button class="btn primary submit" id="aGo">Finish sign-up</button><p class="switch"><button type="button" id="aOut">Use a different account</button></p>';
    }
    root.innerHTML = '<div class="auth">' + h + '</div>';
    wire();
  }
  const err = m => { const e = $("#aErr", root); if (e) e.textContent = m || ""; };
  const busy = (b, label) => { const g = $("#aGo", root); if (!g) return; g.disabled = b; if (label) g.innerHTML = b ? '<span class="spin"></span>' + esc(label) : esc(label); };
  function wirePasswords(){
    const pw = $("#aPw", root), pw2 = $("#aPw2", root), go = $("#aGo", root), email = $("#aEmail", root);
    const update = () => {
      const s = strength(pw.value);
      $("#aMeter", root).dataset.level = s.level; const lv = $("#aLevel", root); lv.dataset.level = s.level; lv.textContent = s.label;
      $("#aHint", root).textContent = !pw.value ? "Use at least 8 characters." : s.level === 3 ? "Great password." : pw.value.length < 8 ? "Use at least 8 characters." : "Add length, upper and lower case, numbers or symbols.";
      const m = $("#aMatch", root);
      if (!pw2.value){ m.textContent = ""; m.className = "match"; }
      else if (pw2.value === pw.value){ m.textContent = "Passwords match"; m.className = "match ok"; }
      else { m.textContent = "Passwords don't match yet"; m.className = "match no"; }
      go.disabled = !(s.level >= 2 && pw.value === pw2.value && (!email || email.value.includes("@")));
    };
    [pw, pw2, email].forEach(i => i && i.addEventListener("input", update));
    update();
  }
  async function afterSignIn(){
    await App.reloadProfile();
    if (!App.profile){ step = "username"; render(); return; }
    if (opts.full) location.replace(next); else location.reload();
  }
  function wire(){
    root.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => { const e = $("#aEmail", root); if (e) root.dataset.email = e.value.trim(); step = b.dataset.step; render(); }));
    root.querySelectorAll("[data-eye]").forEach(b => b.addEventListener("click", () => { const i = $("#" + b.dataset.eye, root); const show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-label", show ? "Hide password" : "Show password"); }));
    root.querySelectorAll("[data-oauth]").forEach(b => b.addEventListener("click", async () => {
      err(""); b.disabled = true;
      const provider = b.dataset.oauth === "google" ? "google" : (CFG.X_PROVIDER || "twitter");
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: loginReturn } });
      if (error){ b.disabled = false; err(/provider is not enabled|Unsupported provider/i.test(error.message) ? (b.dataset.oauth === "google" ? "Google" : "X") + " sign-in isn't switched on yet. Use email for now." : errText(error)); }
    }));
    root.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter"){ const g = $("#aGo", root); if (g && !g.disabled) g.click(); } }));
    const go = $("#aGo", root);
    if (step === "signin") go.addEventListener("click", async () => {
      const ident = $("#aEmail", root).value.trim(), password = $("#aPw", root).value;
      if (!ident || !password){ err("Enter your email or username, and your password."); return; }
      const byEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ident);
      let email = ident;
      err(""); busy(true, "Signing in…");
      if (!byEmail){
        const uname = ident.replace(/^@/, "").toLowerCase();
        if (!USER_RE.test(uname)){ busy(false, "Sign in"); err("Enter your email, or a username like maya.films."); return; }
        const r = await sb.rpc("stash_username_login", { p_username: uname, p_password: password });
        if (r.error){ busy(false, "Sign in"); err(r.error.code === "P0001" ? r.error.message : errText(r.error)); return; }
        if (!r.data){ busy(false, "Sign in"); err("That username and password don't match. Try again, or reset your password with your email."); return; }
        email = r.data;
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error){ busy(false, "Sign in"); err(/Invalid login/i.test(error.message) ? "That " + (byEmail ? "email" : "username") + " and password don't match. Try again or reset your password." : /not confirmed/i.test(error.message) ? "Confirm your email first. We sent you a link when you signed up." : errText(error)); return; }
      App.session = data.session; App.user = data.user; afterSignIn();
    });
    if (step === "signup"){ wirePasswords(); go.addEventListener("click", async () => {
      const email = $("#aEmail", root).value.trim(), password = $("#aPw", root).value;
      if (!/^\S+@\S+\.\S+$/.test(email)){ err("Enter a valid email address."); return; }
      if (strength(password).level < 2){ err("Choose a stronger password."); return; }
      if (password !== $("#aPw2", root).value){ err("Passwords don't match."); return; }
      err(""); busy(true, "Creating account…");
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: loginReturn } });
      if (error){ busy(false, "Create account"); err(/already registered/i.test(error.message) ? "An account with this email already exists. Sign in instead." : /Password should/i.test(error.message) ? error.message : errText(error)); return; }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){ busy(false, "Create account"); err("An account with this email already exists. Sign in instead."); return; }
      root.dataset.email = email;
      if (data.session){ App.session = data.session; App.user = data.user; afterSignIn(); }
      else { step = "check"; render(); }
    }); }
    if (step === "check"){ $("#aResend", root).addEventListener("click", async () => {
      const { error } = await sb.auth.resend({ type: "signup", email: root.dataset.email, options: { emailRedirectTo: loginReturn } });
      if (error) err(errText(error)); else toast("Confirmation email sent again");
    }); }
    if (step === "forgot") go.addEventListener("click", async () => {
      const email = $("#aEmail", root).value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)){ err("Enter the email address on your account. Reset links can't be sent to a username."); return; }
      busy(true, "Sending…");
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login/?reset=1" });
      if (error){ busy(false, "Send reset link"); err(errText(error)); return; }
      root.dataset.email = email; step = "sent"; render();
    });
    if (step === "reset"){ wirePasswords(); go.addEventListener("click", async () => {
      const password = $("#aPw", root).value;
      busy(true, "Saving…");
      const { error } = await sb.auth.updateUser({ password });
      if (error){ busy(false, "Save new password"); err(/different from the old/i.test(error.message) ? "Choose a password different from your old one." : errText(error)); return; }
      toast("Password updated"); afterSignIn();
    }); }
    if (step === "username"){
      $("#aOut", root).addEventListener("click", async () => { await sb.auth.signOut(); App.user = null; App.profile = null; step = "signin"; render(); renderHeader(); });
      const meta = (App.user && App.user.user_metadata) || {};
      const nm = $("#aName", root); if (!nm.value) nm.value = String(meta.full_name || meta.name || "").slice(0, 50);
      const un = $("#aUser", root); if (!un.value){ const guess = String(meta.user_name || meta.preferred_username || "").toLowerCase().replace(/[^a-z0-9_.]/g, "").replace(/^\./, "").slice(0, 24); if (USER_RE.test(guess)) un.value = guess; }
      go.addEventListener("click", async () => {
        const username = un.value.trim().toLowerCase(), display_name = nm.value.trim().slice(0, 50);
        if (!USER_RE.test(username)){ err("Usernames are 3 to 24 characters using letters, numbers, _ and . (not starting with a dot)."); return; }
        busy(true, "Saving…");
        const { error } = await sb.from("profiles").insert({ user_id: App.user.id, manager_id: App.user.id, username, display_name: display_name || username });
        if (error){ busy(false, "Finish sign-up"); err(error.code === "23505" ? (/user_id/.test(error.message) ? "Your account is already set up. Reload the page." : "That username is taken. Try another.") : errText(error)); return; }
        await App.reloadProfile(); toast("Welcome to The Stash, @" + username);
        if (opts.full) location.replace(next); else location.reload();
      });
    }
  }
  render();
  return { setStep(s){ step = s; render(); } };
}
function openAuthModal(mode){
  if (!sb) return;
  openModal('<div id="authRoot"></div>', m => { mountAuth($("#authRoot", m), { mode: mode || "signin", full: false }); }, { cls: "authmodal" });
}
App.requireAccount = function(){
  if (App.signedIn()) return true;
  if (App.user && !App.profile){ location.href = "/login/?next=" + encodeURIComponent(location.pathname + location.search); return false; }
  openAuthModal("signup"); return false;
};

/* ---------- image & video processing ---------- */
function cropImage(file, W, H){
  return new Promise((res, rej) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){ rej(new Error("Pick a JPG, PNG or WebP image.")); return; }
    if (file.size > 25 * 1048576){ rej(new Error("That image is over 25 MB. Pick a smaller one.")); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const r = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * r, h = img.naturalHeight * r;
        c.getContext("2d").drawImage(img, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error("That image couldn't be processed.")), "image/jpeg", 0.88);
      } catch(e){ URL.revokeObjectURL(url); rej(new Error("That image couldn't be processed.")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That image couldn't be opened. Try a different file.")); };
    img.src = url;
  });
}
/* Opens a video file once so frames can be grabbed at any time. */
function frameGrabber(file){
  const url = URL.createObjectURL(file), v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  const ready = new Promise(res => {
    let done = false; const fin = ok => { if (!done){ done = true; res(ok); } };
    v.onloadeddata = () => fin(true); v.onerror = () => fin(false); setTimeout(() => fin(v.readyState >= 1), 10000);
  });
  const api = {
    async duration(){ await ready; return isFinite(v.duration) ? v.duration : 0; },
    async grab(t){
      const ok = await ready; if (!ok || !v.videoWidth) return null;
      await new Promise(res => { let done = false; const fin = () => { if (!done){ done = true; res(); } }; v.onseeked = fin; setTimeout(fin, 4000); try { v.currentTime = Math.max(0, t); } catch(e){ fin(); } });
      try {
        const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
        const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 1280, 720);
        const r = Math.min(1280 / v.videoWidth, 720 / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
        g.drawImage(v, (1280 - w) / 2, (720 - h) / 2, w, h);
        return await new Promise(res => c.toBlob(b => res(b), "image/jpeg", 0.85));
      } catch(e){ return null; }
    },
    async randomFrame(avoid){
      const d = await api.duration();
      let t = d > 0 ? d * (0.05 + Math.random() * 0.9) : 0.5;
      if (avoid != null && d > 2) for (let i = 0; i < 5 && Math.abs(t - avoid) < d * 0.08; i++) t = d * (0.05 + Math.random() * 0.9);
      const blob = await api.grab(t); return blob ? { blob, time: t } : null;
    },
    close(){ v.removeAttribute("src"); try { v.load(); } catch(e){} URL.revokeObjectURL(url); }
  };
  return api;
}
function videoMeta(file){
  return new Promise(res => {
    const url = URL.createObjectURL(file), v = document.createElement("video"); let done = false;
    const finish = (b, d) => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(url); res({ thumb: b, duration: isFinite(d) ? d : 0 }); };
    const t = setTimeout(() => finish(null, v.duration), 10000);
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.onloadedmetadata = () => { const d = isFinite(v.duration) ? v.duration : 2; try { v.currentTime = Math.max(0.05, Math.min(1, d * 0.1)); } catch(e){ finish(null, v.duration); } };
    v.onseeked = () => {
      try {
        if (!v.videoWidth){ finish(null, v.duration); return; }
        const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
        const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 1280, 720);
        const r = Math.min(1280 / v.videoWidth, 720 / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
        g.drawImage(v, (1280 - w) / 2, (720 - h) / 2, w, h);
        c.toBlob(b => finish(b, v.duration), "image/jpeg", 0.85);
      } catch(e){ finish(null, v.duration); }
    };
    v.onerror = () => finish(null, 0);
    v.src = url;
  });
}
/* Uploads straight to Supabase Storage so we can show progress. */
function uploadWithProgress(bucket, path, file, onProgress){
  return new Promise(async (res, rej) => {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token){ rej(new Error("Your session ended. Sign in again.")); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CFG.SUPABASE_URL.replace(/\/$/, "") + "/storage/v1/object/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"));
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("apikey", CFG.SUPABASE_ANON_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) res(path);
      else { let m = "The upload failed (" + xhr.status + ")."; try { const j = JSON.parse(xhr.responseText); m = j.message || j.error || m; } catch(e){} if (xhr.status === 413) m = "That file is larger than the upload limit."; rej(new Error(m)); }
    };
    xhr.onerror = () => rej(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}
/* Asks the import-x Edge Function to fetch a video from one of your X posts. */
async function importFromX(link){
  if (window.__previewImport) return window.__previewImport(link);
  const { data } = await sb.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) throw Object.assign(new Error("Your session ended. Sign in again."), { code: "signin" });
  let r;
  try { r = await fetch(CFG.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/import-x", { method: "POST", headers: { Authorization: "Bearer " + token, apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) }); }
  catch(e){ throw Object.assign(new Error("Couldn't reach the importer. Check your connection, or make sure the import-x function is deployed."), { code: "network" }); }
  let j = null; try { j = await r.json(); } catch(e){}
  if (r.status === 404 && !(j && j.error)) throw Object.assign(new Error("Importing from X isn't set up on this site yet."), { code: "setup" });
  if (!r.ok || !j || j.error) throw Object.assign(new Error((j && j.error && j.error.message) || "The import didn't work. Try again."), { code: (j && j.error && j.error.code) || "error" });
  return j;
}
const xIdentity = () => { const ids = (App.user && App.user.identities) || []; return ids.find(i => i.provider === "twitter" || i.provider === "x") || null; };
async function linkX(returnTo){
  const { error } = await sb.auth.linkIdentity({ provider: CFG.X_PROVIDER || "twitter", options: { redirectTo: location.origin + (returnTo || "/upload/") } });
  if (error) throw error;
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- custom video player ---------- */
const PI = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 5v14l10-7zM16 5h3v14h-3z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h4L13 5v14l-5-4.5H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h4L13 5v14l-5-4.5H4z" fill="currentColor"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
  full: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/></svg>',
  back10: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="700">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="700">10</text></svg>'
};
const clock = t => { t = Math.max(0, Math.floor(+t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(e){} };
function mountPlayer(root, opts){
  opts = opts || {};
  root.classList.add("sp"); root.tabIndex = -1;
  root.innerHTML = '<video playsinline preload="metadata"' + (opts.poster ? ' poster="' + esc(opts.poster) + '"' : "") + ' src="' + esc(opts.src) + '"></video>' +
    '<button class="sp-big" aria-label="Play">' + PI.play + '</button><div class="sp-spin" hidden><span class="spin"></span></div><div class="sp-flash" aria-hidden="true"></div>' +
    '<div class="sp-err" hidden><p>This video couldn\'t play. Check your connection and try again.</p><button class="btn sm">Try again</button></div>' +
    '<div class="sp-bar"><div class="sp-seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00"><div class="sp-track"><i class="sp-buf"></i><i class="sp-played"></i><i class="sp-knob"></i></div><span class="sp-tip" hidden>0:00</span></div>' +
    '<div class="sp-row"><button class="sp-btn sp-play" aria-label="Play">' + PI.play + '</button>' +
    '<button class="sp-btn sp-b10 hide-xs" aria-label="Back 10 seconds">' + PI.back10 + '</button><button class="sp-btn sp-f10 hide-xs" aria-label="Forward 10 seconds">' + PI.fwd10 + '</button>' +
    (opts.onNext ? '<button class="sp-btn sp-next" aria-label="Next video">' + PI.next + '</button>' : "") +
    '<div class="sp-vol"><button class="sp-btn sp-mute" aria-label="Mute">' + PI.vol + '</button><input class="sp-volr" type="range" min="0" max="1" step="0.05" aria-label="Volume"></div>' +
    '<span class="sp-time"><span class="sp-cur">0:00</span> / <span class="sp-dur">0:00</span></span><span class="sp-grow"></span>' +
    '<div class="sp-menuwrap"><button class="sp-btn sp-speed" aria-label="Playback speed" aria-haspopup="true" aria-expanded="false">1×</button><div class="sp-menu" role="menu" hidden>' + [0.25,0.5,0.75,1,1.25,1.5,1.75,2].map(r => '<button role="menuitemradio" data-rate="' + r + '" aria-checked="' + (r === 1) + '">' + (r === 1 ? "Normal" : r + "×") + '</button>').join("") + '</div></div>' +
    ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled ? '<button class="sp-btn sp-pip" aria-label="Picture in picture">' + PI.pip + '</button>' : "") +
    '<button class="sp-btn sp-fs" aria-label="Full screen">' + PI.full + '</button></div></div>';
  const v = root.querySelector("video"), q = s => root.querySelector(s);
  const seek = q(".sp-seek"), played = q(".sp-played"), buf = q(".sp-buf"), knob = q(".sp-knob"), tip = q(".sp-tip"), big = q(".sp-big"), playBtn = q(".sp-play"), muteBtn = q(".sp-mute"), volr = q(".sp-volr"), spd = q(".sp-speed"), menu = q(".sp-menu"), fsBtn = q(".sp-fs");
  const savedVol = parseFloat(lsGet("stash:vol")), savedMute = lsGet("stash:muted") === "1";
  v.volume = isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 1; v.muted = savedMute;
  let scrubbing = false, hideT = null, started = false;
  const dur = () => isFinite(v.duration) ? v.duration : 0;
  const paintTime = () => {
    const d = dur(), t = scrubbing ? scrubbing.t : v.currentTime, pct = d ? Math.min(100, t / d * 100) : 0;
    played.style.width = pct + "%"; knob.style.left = pct + "%";
    q(".sp-cur").textContent = clock(t); q(".sp-dur").textContent = clock(Math.round(d));
    seek.setAttribute("aria-valuemax", String(Math.floor(d))); seek.setAttribute("aria-valuenow", String(Math.floor(t))); seek.setAttribute("aria-valuetext", clock(t) + " of " + clock(d));
    try { const b = v.buffered; let end = 0; for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5) end = Math.max(end, b.end(i)); buf.style.width = (d ? Math.min(100, end / d * 100) : 0) + "%"; } catch(e){}
  };
  const paintPlay = () => {
    const p = v.paused || v.ended;
    playBtn.innerHTML = p ? PI.play : PI.pause; playBtn.setAttribute("aria-label", p ? "Play" : "Pause");
    big.hidden = !p || scrubbing; big.innerHTML = PI.play; root.classList.toggle("paused", p);
  };
  const paintVol = () => { const m = v.muted || v.volume === 0; muteBtn.innerHTML = m ? PI.mute : PI.vol; muteBtn.setAttribute("aria-label", m ? "Unmute" : "Mute"); volr.value = String(v.muted ? 0 : v.volume); volr.style.setProperty("--v", (v.muted ? 0 : v.volume) * 100 + "%"); };
  const flash = html => { const f = q(".sp-flash"); f.innerHTML = html; f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); };
  const toggle = () => { if (v.paused || v.ended){ const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } else v.pause(); };
  const jump = s => { const d = dur(); if (!d) return; v.currentTime = Math.min(d, Math.max(0, v.currentTime + s)); flash('<b>' + (s > 0 ? "+" : "") + s + 's</b>'); wake(); };
  const wake = () => { root.classList.add("show"); clearTimeout(hideT); if (!v.paused && !scrubbing) hideT = setTimeout(() => { if (!v.paused && menu.hidden) root.classList.remove("show"); }, 2600); };
  const isFs = () => (document.fullscreenElement || document.webkitFullscreenElement) === root;
  const toggleFs = () => {
    if (isFs()){ (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) req.call(root); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };
  const fromX = e => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };

  v.addEventListener("click", () => { toggle(); wake(); });
  v.addEventListener("dblclick", toggleFs);
  big.addEventListener("click", () => { toggle(); root.focus({ preventScroll: true }); });
  playBtn.addEventListener("click", toggle);
  q(".sp-b10").addEventListener("click", () => jump(-10)); q(".sp-f10").addEventListener("click", () => jump(10));
  const nx = q(".sp-next"); if (nx) nx.addEventListener("click", () => opts.onNext());
  muteBtn.addEventListener("click", () => { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; });
  volr.addEventListener("input", () => { v.volume = +volr.value; v.muted = +volr.value === 0; });
  spd.addEventListener("click", e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; spd.setAttribute("aria-expanded", String(open)); if (open){ const c = menu.querySelector('[aria-checked="true"]'); if (c) c.focus(); } wake(); });
  menu.addEventListener("click", e => { const b = e.target.closest("[data-rate]"); if (!b) return; v.playbackRate = +b.dataset.rate; menu.querySelectorAll("[data-rate]").forEach(x => x.setAttribute("aria-checked", String(x === b))); spd.textContent = (+b.dataset.rate === 1 ? "1" : b.dataset.rate) + "×"; menu.hidden = true; spd.setAttribute("aria-expanded", "false"); spd.focus(); });
  document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest(".sp-menuwrap")){ menu.hidden = true; spd.setAttribute("aria-expanded", "false"); } });
  const pipBtn = q(".sp-pip"); if (pipBtn) pipBtn.addEventListener("click", async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch(e){} });
  fsBtn.addEventListener("click", toggleFs);
  const onFs = () => { const f = isFs(); fsBtn.innerHTML = f ? PI.exit : PI.full; fsBtn.setAttribute("aria-label", f ? "Exit full screen" : "Full screen"); root.classList.toggle("fs", f); };
  document.addEventListener("fullscreenchange", onFs); document.addEventListener("webkitfullscreenchange", onFs);

  seek.addEventListener("pointerdown", e => { if (!dur()) return; seek.setPointerCapture(e.pointerId); scrubbing = { t: fromX(e) * dur(), wasPlaying: !v.paused }; v.pause(); root.classList.add("scrub"); paintTime(); });
  seek.addEventListener("pointermove", e => {
    const d = dur(); if (!d) return; const f = fromX(e);
    tip.hidden = false; tip.textContent = clock(f * d); tip.style.left = (f * 100) + "%";
    if (scrubbing){ scrubbing.t = f * d; paintTime(); }
  });
  const endScrub = () => { if (!scrubbing) return; const s = scrubbing; scrubbing = false; root.classList.remove("scrub"); v.currentTime = s.t; if (s.wasPlaying){ const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } paintTime(); paintPlay(); wake(); };
  seek.addEventListener("pointerup", endScrub); seek.addEventListener("pointercancel", endScrub);
  seek.addEventListener("pointerleave", () => { tip.hidden = true; });
  seek.addEventListener("keydown", e => {
    const d = dur(); if (!d) return; let t = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") t = v.currentTime + 5; else if (e.key === "ArrowLeft" || e.key === "ArrowDown") t = v.currentTime - 5;
    else if (e.key === "Home") t = 0; else if (e.key === "End") t = d; else if (e.key === "PageUp") t = v.currentTime + 10; else if (e.key === "PageDown") t = v.currentTime - 10;
    if (t != null){ e.preventDefault(); e.stopPropagation(); v.currentTime = Math.min(d, Math.max(0, t)); wake(); }
  });

  ["timeupdate","durationchange","progress","seeked","loadedmetadata"].forEach(ev => v.addEventListener(ev, paintTime));
  v.addEventListener("play", () => { started = true; root.classList.add("started"); paintPlay(); wake(); });
  v.addEventListener("pause", () => { paintPlay(); wake(); });
  v.addEventListener("ended", () => { paintPlay(); root.classList.add("show"); if (opts.onEnded) opts.onEnded(); });
  v.addEventListener("volumechange", () => { paintVol(); lsSet("stash:vol", String(v.volume)); lsSet("stash:muted", v.muted ? "1" : "0"); });
  v.addEventListener("waiting", () => { q(".sp-spin").hidden = false; });
  ["playing","canplay","seeked","pause"].forEach(ev => v.addEventListener(ev, () => { q(".sp-spin").hidden = true; }));
  v.addEventListener("error", () => { if (v.error){ q(".sp-err").hidden = false; big.hidden = true; } });
  q(".sp-err button").addEventListener("click", () => { q(".sp-err").hidden = true; const t = v.currentTime; v.load(); v.currentTime = t; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); });
  root.addEventListener("pointermove", wake); root.addEventListener("pointerdown", wake); root.addEventListener("focusin", wake);
  root.addEventListener("mouseleave", () => { if (!v.paused && menu.hidden) root.classList.remove("show"); });

  // keyboard shortcuts while you're on the page and not typing
  document.addEventListener("keydown", e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable) return;
    if (document.querySelector("#modalRoot .modal") || document.body.classList.contains("drawer-open")) return;
    if ((tag === "button" || tag === "a") && (e.key === " " || e.key === "Enter")) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k"){ e.preventDefault(); toggle(); flash(v.paused ? PI.pause : PI.play); }
    else if (k === "j") jump(-10); else if (k === "l") jump(10);
    else if (k === "arrowleft"){ e.preventDefault(); jump(-5); } else if (k === "arrowright"){ e.preventDefault(); jump(5); }
    else if (k === "arrowup" && root.contains(t)){ e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); v.muted = false; flash('<b>' + Math.round(v.volume * 100) + '%</b>'); }
    else if (k === "arrowdown" && root.contains(t)){ e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); flash('<b>' + Math.round(v.volume * 100) + '%</b>'); }
    else if (k === "m"){ v.muted = !v.muted; flash(v.muted ? PI.mute : PI.vol); }
    else if (k === "f") toggleFs();
    else if (/^[0-9]$/.test(k) && dur()){ v.currentTime = dur() * (+k / 10); wake(); }
    else return;
    wake();
  });
  paintTime(); paintPlay(); paintVol(); root.classList.add("show");
  return { video: v, play(){ const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); return pr; } };
}

/* ---------- boot ---------- */
function setupNotice(){
  const app = $("#app") || $("#loginCard"); if (!app) return;
  app.innerHTML = '<div class="setup"><h2 style="font-size:22px;margin-bottom:8px">The Stash needs one more step</h2><p>Open <code>assets/config.js</code> and paste in your Supabase Project URL and anon key. The README walks through every step.</p></div>';
}
App.start = async function(render){
  renderHeader();
  if (!sb){ setupNotice(); return; }
  await App.ready;
  renderHeader();
  sb.auth.onAuthStateChange((event, session) => {
    const changed = (session ? session.user.id : null) !== (App.user ? App.user.id : null);
    App.session = session; App.user = session ? session.user : null;
    if (event === "PASSWORD_RECOVERY" && document.body.dataset.page !== "login"){ location.href = "/login/?reset=1"; return; }
    if (changed){ setTimeout(async () => { await loadMyProfile(); renderHeader(); if (App.onAuthChange) App.onAuthChange(event); }, 0); }
    else if (App.onAuthChange) App.onAuthChange(event);
  });
  try { await render(); }
  catch(e){ const app = $("#app"); if (app) app.innerHTML = '<div class="empty"><h2>This page didn\'t load</h2><p>' + esc(errText(e)) + '</p><button class="btn primary" onclick="location.reload()">Try again</button></div>'; console.error(e); }
};

Object.assign(App, { $, esc, colorFor, initials, timeAgo, fmtDur, fmtCount, plural, safeUrl, safeNext, param, pub, USER_RE, must, errText, toast,
  openModal, closeModal, confirmModal, avatar, chAvatar, thumbInner, vcard, hydrate, profilesByIds, PROFILE_COLS, videosByIds, watchUrl, profileUrl,
  badges, displayName, BANNERS, presetUrl, bannerHTML, frameGrabber, anniversary, ordinal, mountPlayer, importFromX, xIdentity, linkX, lsGet, lsSet,
  renderHeader, mountAuth, openAuthModal, strength, cropImage, videoMeta, uploadWithProgress, uuid });
window.Stash = App;
})();
