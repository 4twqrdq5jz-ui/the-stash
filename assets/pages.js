/* The Stash: page logic. Each HTML page sets <body data-page="..."> */
(function(){
"use strict";
const S = window.Stash;
const { $, esc, sb, plural, fmtCount, fmtDur, timeAgo, colorFor, initials, avatar, thumbInner, vcard, hydrate, profilesByIds, videosByIds, must, errText, toast, openModal, closeModal, confirmModal, watchUrl, profileUrl, param, badges, displayName } = S;
const app = () => $("#app");
const PAGE = 48;
const empty = (title, body, cta) => '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p>' + (cta || "") + '</div>';
const signInCta = '<a class="btn primary" href="/login/?mode=signup" data-auth="signup">Sign up</a> <a class="btn ghost" href="/login/" data-auth="signin">Sign in</a>';
const notFound = (what) => empty(what + " not found", "It may have been deleted, or the link is wrong.", '<a class="btn primary" href="/">Go home</a>');
const grid = (vids, maps, opts) => '<div class="grid">' + vids.map(v => vcard(v, maps, opts)).join("") + '</div>';
function setTitle(t){ document.title = t ? t + " | The Stash" : "The Stash"; }
const isChannel = p => !!(p && p.kind === "channel");

/* ---------- shared data ---------- */
async function myState(){
  if (!S.signedIn()) return { likes: new Set(), subs: new Set(), follows: new Set(), dislikes: new Set(), favs: new Set() };
  const me = S.profile.id;
  const [l, s, f, d, fv] = await Promise.all([
    sb.from("likes").select("video_id").eq("profile_id", me).limit(5000),
    sb.from("subscriptions").select("channel_id").eq("profile_id", me).limit(5000),
    sb.from("follows").select("followee_id").eq("follower_id", me).limit(5000),
    sb.from("dislikes").select("video_id").eq("profile_id", me).limit(5000),
    sb.from("favorites").select("video_id").eq("profile_id", me).limit(5000)
  ]);
  const set = (r, k) => new Set((r.data || []).map(x => x[k]));
  return { likes: set(l, "video_id"), subs: set(s, "channel_id"), follows: set(f, "followee_id"), dislikes: set(d, "video_id"), favs: set(fv, "video_id") };
}
async function profileStats(id){ const { data } = await sb.from("profile_stats").select("*").eq("id", id).maybeSingle(); return data || { followers: 0, following: 0, subscribers: 0, video_count: 0 }; }
async function managerOf(p){ if (!p || !p.manager_id) return null; const { data } = await sb.from("profiles").select(S.PROFILE_COLS).eq("user_id", p.manager_id).maybeSingle(); return data || null; }

async function toggleFollow(target, on){
  if (!S.requireAccount()) return null;
  if (target.id === S.profile.id) return null;
  if (isChannel(target)){ toast("Channels are subscribed to, not followed."); return null; }
  const me = S.profile.id;
  const res = on ? await sb.from("follows").insert({ follower_id: me, followee_id: target.id }) : await sb.from("follows").delete().eq("follower_id", me).eq("followee_id", target.id);
  if (res.error && res.error.code !== "23505"){ toast(errText(res.error, "That didn't save. Try again.")); return null; }
  return on;
}
async function toggleSub(channel, on){
  if (!S.requireAccount()) return null;
  if (S.manages(channel.id)){ toast("That's your own channel."); return null; }
  const me = S.profile.id;
  const res = on ? await sb.from("subscriptions").insert({ profile_id: me, channel_id: channel.id }) : await sb.from("subscriptions").delete().eq("profile_id", me).eq("channel_id", channel.id);
  if (res.error && res.error.code !== "23505"){ toast(errText(res.error, "That didn't save. Try again.")); return null; }
  if (on) toast("Subscribed to " + displayName(channel));
  return on;
}
/* Follow / Subscribe button for any profile. Returns "" when it's yours. */
function relationBtn(p, st, size){
  if (S.signedIn() && (p.id === S.profile.id || S.manages(p.id))) return "";
  const sm = size === "sm" ? " sm" : "";
  if (isChannel(p)){ const on = st.subs.has(p.id); return '<button class="btn' + sm + ' ' + (on ? "on" : "dark") + '" data-rel="' + esc(p.id) + '">' + (on ? "Subscribed" : "Subscribe") + '</button>'; }
  const on = st.follows.has(p.id); return '<button class="btn' + sm + ' ' + (on ? "on" : (size === "sm" ? "ghost" : "dark")) + '" data-rel="' + esc(p.id) + '">' + (on ? "Following" : "Follow") + '</button>';
}
async function handleRel(p, st){
  if (isChannel(p)){ const r = await toggleSub(p, !st.subs.has(p.id)); if (r === true) st.subs.add(p.id); else if (r === false) st.subs.delete(p.id); return r; }
  const r = await toggleFollow(p, !st.follows.has(p.id)); if (r === true) st.follows.add(p.id); else if (r === false) st.follows.delete(p.id); return r;
}
const nameLine = p => esc(displayName(p)) + badges(p);
function personRow(p, st){
  return '<div class="urow"><a class="who" href="' + esc(profileUrl(p)) + '">' + avatar(p, 40) + '<span style="min-width:0"><span class="name">' + nameLine(p) + '</span><span class="sub">@' + esc(p.username) + '</span></span></a>' + (st ? relationBtn(p, st, "sm") : "") + '</div>';
}

/* ---------- categories, models, time helpers ---------- */
let catCache = null;
async function loadCategories(force){
  if (catCache && !force) return catCache;
  const { data } = await sb.from("categories").select("*").order("name");
  catCache = data || []; return catCache;
}
const catUrl = c => "/category/?c=" + encodeURIComponent(c.slug);
const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
function parseTime(str){
  str = String(str || "").trim(); if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) return +str;
  const parts = str.split(":").map(x => x.trim());
  if (parts.length > 3 || parts.some(x => !/^\d+$/.test(x))) return NaN;
  return parts.reduce((t, x) => t * 60 + +x, 0);
}
async function searchModels(q){
  const pat = "%" + q.replace(/[\\%_]/g, m => "\\" + m) + "%";
  const [a, b] = await Promise.all([
    sb.from("profiles").select(S.PROFILE_COLS).eq("is_model", true).ilike("username", pat).limit(8),
    sb.from("profiles").select(S.PROFILE_COLS).eq("is_model", true).ilike("display_name", pat).limit(8)
  ]);
  return [...new Map([...(a.data || []), ...(b.data || [])].map(p => [p.id, p])).values()].slice(0, 8);
}
/* Search box for tagging verified models. */
function modelPicker(root, initial){
  let chosen = (initial || []).slice(), results = [], t = null, seq = 0;
  root.innerHTML = '<div class="mpick"><div class="mchips" id="mpChips"></div><div class="mpsearch"><input class="input" id="mpQ" placeholder="Search verified models by name or username" autocomplete="off" aria-label="Add a model" role="combobox" aria-expanded="false" aria-controls="mpRes"><div class="mpres" id="mpRes" role="listbox" hidden></div></div></div>';
  const chips = root.querySelector("#mpChips"), qi = root.querySelector("#mpQ"), res = root.querySelector("#mpRes");
  const paintChips = () => {
    chips.innerHTML = chosen.map(p => '<span class="mchip">' + avatar(p, 22) + '<span>' + esc(displayName(p)) + '</span>' + (p._status === "pending" ? '<em>waiting for approval</em>' : "") + '<button type="button" data-rm="' + esc(p.id) + '" aria-label="Remove ' + esc(displayName(p)) + '">×</button></span>').join("") || '<span class="vsmall">No models tagged.</span>';
  };
  const paintRes = () => {
    if (!qi.value.trim()){ res.hidden = true; qi.setAttribute("aria-expanded", "false"); return; }
    res.hidden = false; qi.setAttribute("aria-expanded", "true");
    const list = results.filter(p => !chosen.some(c => c.id === p.id));
    res.innerHTML = list.length ? list.map(p => '<button type="button" role="option" data-add="' + esc(p.id) + '">' + avatar(p, 28) + '<span><b>' + esc(displayName(p)) + '</b> @' + esc(p.username) + '</span></button>').join("") : '<div class="vsmall" style="padding:10px">No verified models match. People become models by applying on their profile.</div>';
  };
  chips.addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b) return; chosen = chosen.filter(p => p.id !== b.dataset.rm); paintChips(); });
  res.addEventListener("click", e => { const b = e.target.closest("[data-add]"); if (!b) return; const p = results.find(x => x.id === b.dataset.add); if (p && chosen.length < 20) chosen.push(p); qi.value = ""; paintChips(); paintRes(); qi.focus(); });
  qi.addEventListener("input", () => { clearTimeout(t); const v = qi.value.trim(); if (!v){ paintRes(); return; } t = setTimeout(async () => { const my = ++seq; const r = await searchModels(v); if (my === seq){ results = r; paintRes(); } }, 220); });
  qi.addEventListener("keydown", e => { if (e.key === "Escape"){ qi.value = ""; paintRes(); } if (e.key === "Enter"){ e.preventDefault(); const f = res.querySelector("[data-add]"); if (f) f.click(); } });
  document.addEventListener("click", e => { if (!root.contains(e.target)){ res.hidden = true; qi.setAttribute("aria-expanded", "false"); } });
  paintChips();
  return { ids: () => chosen.map(p => p.id) };
}
/* Keep a video's model tags in step with the picker. */
async function syncModelTags(videoId, wantIds, haveIds){
  const add = wantIds.filter(i => !haveIds.includes(i)), drop = haveIds.filter(i => !wantIds.includes(i));
  if (add.length){ const r = await sb.from("video_models").insert(add.map(model_id => ({ video_id: videoId, model_id }))); if (r.error && r.error.code !== "23505") throw r.error; }
  for (const m of drop){ const r = await sb.from("video_models").delete().eq("video_id", videoId).eq("model_id", m); if (r.error) throw r.error; }
}
function categoryPicker(id, cats, selected){
  selected = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
  return '<div class="categorychecks" id="' + id + '">' + (cats.length ? cats.map(c => '<label class="check"><input type="checkbox" value="' + esc(c.id) + '"' + (selected.has(c.id) ? " checked" : "") + '><span>' + esc(c.name) + '</span></label>').join("") : '<span class="vsmall">No categories available.</span>') + '</div>';
}
function actionEditor(id, initial){
  const rows = initial || [];
  const row = a => '<div class="jumpeditrow"><div class="field"><label>Action name</label><input class="input" data-action-name maxlength="80" required value="' + esc(a ? a.name : "") + '" placeholder="e.g. First kiss"></div><div class="field"><label>Time</label><div class="xrow"><input class="input" data-action-time required inputmode="numeric" value="' + (a ? esc(S.clock(a.action_time)) : "") + '" placeholder="2:15"><button class="btn sm ghost" data-action-now type="button">Use now</button><button class="btn sm ghost" data-action-remove type="button" aria-label="Remove action">×</button></div></div></div>';
  return '<div id="' + id + '" class="jumpeditor">' + rows.map(row).join("") + '<button class="btn sm ghost" data-action-add type="button">Add jump to action</button></div>';
}
function readActions(root, duration){
  const actions = [], rows = [...root.querySelectorAll(".jumpeditrow")];
  for (const r of rows){
    const name = r.querySelector("[data-action-name]").value.trim(), time = parseTime(r.querySelector("[data-action-time]").value);
    if (!name || name.length > 80 || time == null || isNaN(time) || time < 0 || time >= duration) return { error: "Each jump to action needs a name and a time inside the video, like 2:15." };
    actions.push({ name, action_time: Math.round(time * 10) / 10 });
  }
  return { actions };
}
function wireActionEditor(root, preview){
  root.addEventListener("click", e => {
    const remove = e.target.closest("[data-action-remove]");
    if (remove) remove.closest(".jumpeditrow").remove();
    const now = e.target.closest("[data-action-now]");
    if (now) now.parentElement.querySelector("[data-action-time]").value = S.clock(preview.currentTime || 0);
    const add = e.target.closest("[data-action-add]");
    if (add){
      add.insertAdjacentHTML("beforebegin", '<div class="jumpeditrow"><div class="field"><label>Action name</label><input class="input" data-action-name maxlength="80" required placeholder="e.g. First kiss"></div><div class="field"><label>Time</label><div class="xrow"><input class="input" data-action-time required inputmode="numeric" placeholder="2:15"><button class="btn sm ghost" data-action-now type="button">Use now</button><button class="btn sm ghost" data-action-remove type="button" aria-label="Remove action">×</button></div></div></div>');
    }
  });
}
async function syncVideoCategories(videoId, categoryIds, previousIds){
  const add = categoryIds.filter(id => !previousIds.includes(id)), drop = previousIds.filter(id => !categoryIds.includes(id));
  if (add.length) must(await sb.from("video_categories").insert(add.map(category_id => ({ video_id: videoId, category_id }))));
  for (const category_id of drop) must(await sb.from("video_categories").delete().eq("video_id", videoId).eq("category_id", category_id));
}
async function syncVideoActions(videoId, actions){
  must(await sb.from("video_actions").delete().eq("video_id", videoId));
  if (actions.length) must(await sb.from("video_actions").insert(actions.map(a => ({ video_id: videoId, name: a.name, action_time: a.action_time }))));
}

/* ---------- people list modal ---------- */
async function openPeople(profile, which){
  const title = { followers: "Followers", following: "Following", subscribers: "Subscribers" }[which];
  const m = openModal('<h2>' + title + '</h2><p class="lede">@' + esc(profile.username) + '</p><div class="ulist" id="pplList"><div class="loading" style="padding:30px 0"><span class="spin"></span></div></div><div class="foot"><button class="btn ghost" data-close>Close</button></div>');
  let ids = [];
  if (which === "subscribers") ids = (must(await sb.from("subscriptions").select("profile_id").eq("channel_id", profile.id).order("created_at", { ascending: false }).limit(500)) || []).map(r => r.profile_id);
  else if (which === "followers") ids = (must(await sb.from("follows").select("follower_id").eq("followee_id", profile.id).order("created_at", { ascending: false }).limit(500)) || []).map(r => r.follower_id);
  else ids = (must(await sb.from("follows").select("followee_id").eq("follower_id", profile.id).order("created_at", { ascending: false }).limit(500)) || []).map(r => r.followee_id);
  const map = await profilesByIds(ids), people = ids.map(i => map.get(i)).filter(Boolean);
  const st = await myState();
  const paint = () => {
    const list = $("#pplList", m); if (!list) return;
    list.innerHTML = people.length ? people.map(p => personRow(p, st)).join("") : '<p class="vsmall">' + ({ followers: "No followers yet.", following: "Not following anyone yet.", subscribers: "No subscribers yet." }[which]) + '</p>';
  };
  paint();
  $("#pplList", m).addEventListener("click", async e => {
    const b = e.target.closest("[data-rel]"); if (!b) return;
    const p = people.find(x => x.id === b.dataset.rel); if (!p) return;
    b.disabled = true; await handleRel(p, st); paint(); if (S.onPeopleChange) S.onPeopleChange();
  });
}

/* ---------- save-to-playlist modal ---------- */
async function openSave(videoId){
  if (!S.requireAccount()) return;
  const m = openModal('<h2>Save to playlist</h2><div id="svList" style="margin-top:10px"><div class="loading" style="padding:20px 0"><span class="spin"></span></div></div>' +
    '<div class="field"><label for="svNew">New playlist</label><div style="display:flex;gap:8px"><input class="input" id="svNew" maxlength="80" placeholder="Playlist name"><button class="btn primary" id="svCreate">Create</button></div></div><div class="err" id="svErr" role="alert"></div>' +
    '<div class="foot"><button class="btn ghost" data-close>Done</button></div>');
  let lists = [], has = new Set();
  const load = async () => {
    lists = must(await sb.from("playlists").select("id,name").eq("owner_id", S.profile.id).order("updated_at", { ascending: false }).limit(200)) || [];
    const items = lists.length ? (must(await sb.from("playlist_items").select("playlist_id").eq("video_id", videoId).in("playlist_id", lists.map(l => l.id))) || []) : [];
    has = new Set(items.map(i => i.playlist_id));
  };
  const paint = () => { const el = $("#svList", m); if (!el) return; el.innerHTML = lists.length ? lists.map(l => '<label class="check"><input type="checkbox" data-pl="' + esc(l.id) + '"' + (has.has(l.id) ? " checked" : "") + '><span>' + esc(l.name) + '</span></label>').join("") : '<p class="vsmall">No playlists yet. Create one below.</p>'; };
  try { await load(); paint(); } catch(e){ $("#svList", m).innerHTML = '<p class="vsmall">' + esc(errText(e)) + '</p>'; }
  $("#svList", m).addEventListener("change", async e => {
    const id = e.target.dataset.pl; if (!id) return;
    const on = e.target.checked, l = lists.find(x => x.id === id); e.target.disabled = true;
    const res = on ? await sb.from("playlist_items").insert({ playlist_id: id, video_id: videoId }) : await sb.from("playlist_items").delete().eq("playlist_id", id).eq("video_id", videoId);
    e.target.disabled = false;
    if (res.error && res.error.code !== "23505"){ e.target.checked = !on; toast(errText(res.error)); return; }
    sb.from("playlists").update({ updated_at: new Date().toISOString() }).eq("id", id).then(() => {});
    if (on) has.add(id); else has.delete(id);
    toast((on ? "Added to " : "Removed from ") + l.name);
  });
  const create = async () => {
    const inp = $("#svNew", m), name = inp.value.trim(), b = $("#svCreate", m); if (!name){ inp.focus(); return; }
    b.disabled = true;
    const r = await sb.from("playlists").insert({ owner_id: S.profile.id, name }).select().single();
    if (!r.error){ const r2 = await sb.from("playlist_items").insert({ playlist_id: r.data.id, video_id: videoId }); if (r2.error) toast(errText(r2.error)); else { lists.unshift(r.data); has.add(r.data.id); inp.value = ""; paint(); toast("Added to " + name); } }
    else $("#svErr", m).textContent = errText(r.error);
    b.disabled = false;
  };
  $("#svCreate", m).addEventListener("click", create);
  $("#svNew", m).addEventListener("keydown", e => { if (e.key === "Enter") create(); });
}

/* ---------- edit profile modal (profiles and channels) ---------- */
function openEditProfile(target, onSaved){
  if (!S.requireAccount()) return;
  const p = target || S.profile;
  if (!S.manages(p.id)){ toast("You can't edit this profile."); return; }
  const chan = isChannel(p);
  const st = { avatarBlob: null, removeAvatar: false, bannerBlob: null, bannerPreset: p.banner_preset || null, bannerPath: p.banner_path || null, picking: false,
    links: (Array.isArray(p.links) ? p.links : []).map(l => ({ label: l.label || "", url: l.url || "" })) };
  const urls = [];
  const hasAvatar = () => !!(st.avatarBlob || (!st.removeAvatar && p.avatar_path));
  const hasBanner = () => !!(st.bannerBlob || st.bannerPath || st.bannerPreset);
  const linksHtml = () => st.links.map((l, i) => '<div class="linkrow"><input class="input" data-li="' + i + '" data-k="label" placeholder="Label, e.g. Portfolio" maxlength="40" value="' + esc(l.label) + '" aria-label="Link ' + (i + 1) + ' label"><input class="input" data-li="' + i + '" data-k="url" placeholder="https://…" maxlength="300" value="' + esc(l.url) + '" aria-label="Link ' + (i + 1) + ' address"><button class="btn sm ghost" data-rm="' + i + '">Remove</button></div>').join("") + (st.links.length < 5 ? '<button class="btn sm ghost" data-addlink="1">Add link</button>' : '<span class="vsmall">You can add up to 5 links.</span>');
  openModal('<h2>' + (chan ? "Edit channel" : "Edit profile") + '</h2><div class="mediaedit"><div class="banner" id="epBanner"></div><div class="avwrap" id="epAv"></div></div>' +
    '<div class="mediabtns" id="epMediaBtns"></div><div id="epPicker"></div>' +
    '<div class="field"><label for="epUser">Username</label><input class="input" id="epUser" maxlength="24" autocapitalize="off" spellcheck="false" value="' + esc(p.username) + '"></div>' +
    '<div class="field"><label for="epName">' + (chan ? "Channel name" : "Profile name") + '</label><input class="input" id="epName" maxlength="50" value="' + esc(p.display_name) + '"></div>' +
    '<div class="field"><label for="epBio">' + (chan ? "About" : "Bio") + ' <span class="hint">up to 300 characters</span></label><textarea id="epBio" maxlength="300" style="min-height:80px">' + esc(p.bio) + '</textarea></div>' +
    '<div class="field"><label>Links</label><div id="epLinks"></div></div><div class="err" id="epErr" role="alert"></div>' +
    '<div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="epSave">Save changes</button></div>', m => {
    const err = $("#epErr", m);
    const paint = () => {
      urls.forEach(u => URL.revokeObjectURL(u)); urls.length = 0;
      let bsrc = "";
      if (st.bannerBlob){ bsrc = URL.createObjectURL(st.bannerBlob); urls.push(bsrc); }
      else if (st.bannerPreset) bsrc = S.presetUrl(st.bannerPreset);
      else if (st.bannerPath) bsrc = S.pub("images", st.bannerPath);
      $("#epBanner", m).innerHTML = bsrc ? '<img src="' + esc(bsrc) + '" alt="Banner preview">' : '<div style="width:100%;height:100%;background:linear-gradient(120deg,' + colorFor(p.id) + ',var(--surface-2))"></div>';
      let asrc = "";
      if (st.avatarBlob){ asrc = URL.createObjectURL(st.avatarBlob); urls.push(asrc); } else if (!st.removeAvatar && p.avatar_path) asrc = S.pub("images", p.avatar_path);
      $("#epAv", m).innerHTML = '<span class="av" style="width:76px;height:76px;font-size:32px;background:' + colorFor(p.id) + '">' + (asrc ? '<img src="' + esc(asrc) + '" alt="Profile picture preview">' : initials(p.display_name || p.username)) + '</span>';
      $("#epMediaBtns", m).innerHTML = '<label class="btn sm ghost" style="cursor:pointer">' + (hasAvatar() ? "Change photo" : "Add photo") + '<input type="file" id="epAvF" accept="image/png,image/jpeg,image/webp" class="sr"></label>' +
        (hasAvatar() ? '<button class="btn sm ghost" id="epAvX">Remove photo</button>' : "") +
        '<button class="btn sm ghost" id="epBnC" aria-expanded="' + st.picking + '">' + (st.picking ? "Done choosing" : (hasBanner() ? "Change banner" : "Add banner")) + '</button>' +
        (hasBanner() ? '<button class="btn sm ghost" id="epBnX">Remove banner</button>' : "");
      $("#epAvF", m).addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { st.avatarBlob = await S.cropImage(f, 400, 400); st.removeAvatar = false; err.textContent = ""; paint(); } catch(x){ err.textContent = x.message; } });
      const ax = $("#epAvX", m); if (ax) ax.addEventListener("click", () => { st.avatarBlob = null; st.removeAvatar = true; paint(); });
      $("#epBnC", m).addEventListener("click", () => { st.picking = !st.picking; paint(); });
      const bx = $("#epBnX", m); if (bx) bx.addEventListener("click", () => { st.bannerBlob = null; st.bannerPreset = null; st.bannerPath = null; st.picking = false; paint(); });
      const pk = $("#epPicker", m);
      if (!st.picking){ pk.innerHTML = ""; return; }
      pk.innerHTML = '<div class="field" style="margin-top:12px"><label>Choose a banner</label><div class="bannerpick" role="group" aria-label="Banners">' +
        '<label class="up" title="Upload your own">Upload your own<input type="file" id="epBnF" accept="image/png,image/jpeg,image/webp" class="sr"></label>' +
        Object.keys(S.BANNERS).map(id => '<button type="button" data-preset="' + id + '" class="' + (st.bannerPreset === id && !st.bannerBlob ? "sel" : "") + '" aria-pressed="' + (st.bannerPreset === id && !st.bannerBlob) + '" aria-label="' + esc(S.BANNERS[id].name) + '"><img src="' + S.presetUrl(id) + '" alt=""><span class="lbl">' + esc(S.BANNERS[id].name) + '</span></button>').join("") +
        '</div><p class="vsmall" style="margin-top:6px">Uploaded banners are cropped to 1800 × 450. Wide images look best.</p></div>';
      pk.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { st.bannerPreset = b.dataset.preset; st.bannerBlob = null; st.bannerPath = null; paint(); }));
      $("#epBnF", m).addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { st.bannerBlob = await S.cropImage(f, 1800, 450); st.bannerPreset = null; st.bannerPath = null; err.textContent = ""; paint(); } catch(x){ err.textContent = x.message; } });
    };
    const paintLinks = () => { $("#epLinks", m).innerHTML = linksHtml(); };
    paint(); paintLinks();
    $("#epLinks", m).addEventListener("input", e => { const i = e.target.dataset.li; if (i != null) st.links[+i][e.target.dataset.k] = e.target.value; });
    $("#epLinks", m).addEventListener("click", e => {
      if (e.target.dataset.rm != null){ st.links.splice(+e.target.dataset.rm, 1); paintLinks(); }
      else if (e.target.dataset.addlink && st.links.length < 5){ st.links.push({ label: "", url: "" }); paintLinks(); const rows = $("#epLinks", m).querySelectorAll(".linkrow"); rows[rows.length - 1].querySelector("input").focus(); }
    });
    $("#epSave", m).addEventListener("click", async () => {
      const save = $("#epSave", m);
      const username = $("#epUser", m).value.trim().toLowerCase(), display_name = $("#epName", m).value.trim().slice(0, 50), bio = $("#epBio", m).value.trim().slice(0, 300);
      if (!S.USER_RE.test(username)){ err.textContent = "Usernames are 3 to 24 characters using letters, numbers, _ and . (not starting with a dot)."; return; }
      const links = [];
      for (const l of st.links){
        if (!l.url.trim() && !l.label.trim()) continue;
        const u = S.safeUrl(l.url); if (!u){ err.textContent = "“" + (l.url || l.label) + "” isn't a valid web address. Use a link like https://example.com."; return; }
        links.push({ label: l.label.trim().slice(0, 40), url: u });
      }
      err.textContent = ""; save.disabled = true; save.innerHTML = '<span class="spin"></span>Saving…';
      const uploaded = [], folder = S.user.id;
      try {
        let avatar_path = st.removeAvatar ? null : (p.avatar_path || null);
        let banner_path = st.bannerPath, banner_preset = st.bannerPreset;
        if (st.avatarBlob){ const path = folder + "/avatar-" + Date.now() + ".jpg"; must(await sb.storage.from("images").upload(path, st.avatarBlob, { contentType: "image/jpeg" })); uploaded.push(path); avatar_path = path; }
        if (st.bannerBlob){ const path = folder + "/banner-" + Date.now() + ".jpg"; must(await sb.storage.from("images").upload(path, st.bannerBlob, { contentType: "image/jpeg" })); uploaded.push(path); banner_path = path; banner_preset = null; }
        const r = await sb.from("profiles").update({ username, display_name: display_name || username, bio, links, avatar_path, banner_path: banner_path || null, banner_preset: banner_preset || null }).eq("id", p.id).select().single();
        if (r.error){ if (r.error.code === "23505") throw new Error("That username is taken. Try another."); throw r.error; }
        const old = [p.avatar_path && p.avatar_path !== avatar_path && p.avatar_path, p.banner_path && p.banner_path !== banner_path && p.banner_path].filter(Boolean);
        if (old.length) sb.storage.from("images").remove(old).then(() => {});
        urls.forEach(u => URL.revokeObjectURL(u));
        await S.reloadProfile(); closeModal(); toast(chan ? "Channel saved" : "Profile saved");
        if (onSaved) onSaved(r.data);
      } catch(e){
        if (uploaded.length) sb.storage.from("images").remove(uploaded).then(() => {});
        err.textContent = errText(e, "Your changes didn't save. Try again."); save.disabled = false; save.textContent = "Save changes";
      }
    });
  });
}

/* ================= pages ================= */
const PAGES = {};

function annivNotice(){
  if (!S.signedIn()) return "";
  const a = S.anniversary(S.profile.created_at), key = "stash:anniv-seen:" + S.profile.id + ":" + new Date().getFullYear();
  if (!a.today || S.lsGet(key)) return "";
  return '<div class="annivbar" id="annivHome" role="status" style="margin:0 0 20px"><span class="cake" aria-hidden="true">🎂</span><div><b>Happy ' + S.ordinal(a.years) + ' Stash anniversary, @' + esc(S.profile.username) + '!</b><span>You joined on ' + esc(a.joinedFull) + '. <a href="' + esc(profileUrl(S.profile)) + '&tab=achievements">See your achievements</a></span></div><button class="iconbtn x" id="annivX" aria-label="Dismiss"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
}
function wireAnniv(){ const x = $("#annivX"); if (x) x.addEventListener("click", () => { S.lsSet("stash:anniv-seen:" + S.profile.id + ":" + new Date().getFullYear(), "1"); const b = $("#annivHome"); if (b) b.remove(); }); }
PAGES.home = async () => {
  setTitle("");
  let offset = 0, all = [];
  const el = app();
  const load = async () => {
    const rows = must(await sb.from("video_feed").select("*").order("created_at", { ascending: false }).range(offset, offset + PAGE - 1)) || [];
    offset += rows.length; all = all.concat(rows);
    const maps = await hydrate(all);
    if (!all.length){ el.innerHTML = empty("The stash is empty", "No videos are live yet. Verified models can upload, and videos go public once everyone in them has approved.", S.canUpload() ? '<a class="btn primary" href="/upload/">Upload a video</a>' : (S.signedIn() ? '<a class="btn primary" href="' + esc(profileUrl(S.profile)) + '&tab=model">Become a verified model</a>' : signInCta)); return; }
    const cats = await loadCategories();
    el.innerHTML = annivNotice() + (cats.length ? '<nav class="catchips" aria-label="Categories"><a class="catchip on" href="/">All</a>' + cats.map(c => '<a class="catchip" href="' + esc(catUrl(c)) + '">' + esc(c.name) + '</a>').join("") + '</nav>' : "") + grid(all, maps) + (rows.length === PAGE ? '<div class="more"><button class="btn" id="more">Show more</button></div>' : "");
    wireAnniv();
    const mb = $("#more"); if (mb) mb.addEventListener("click", async () => { mb.disabled = true; mb.innerHTML = '<span class="spin"></span>Loading…'; try { await load(); } catch(e){ toast(errText(e)); mb.disabled = false; mb.textContent = "Show more"; } });
  };
  await load();
};

function chCard(p, stats){
  const s = stats || {};
  return '<a class="chcard" href="' + esc(profileUrl(p)) + '">' + avatar(p, 52) + '<span style="min-width:0"><span style="font-weight:600;display:block">' + nameLine(p) + '</span><span class="vsmall">@' + esc(p.username) + (s.subscribers != null ? ", " + plural(s.subscribers, "subscriber") : "") + '</span></span></a>';
}
async function statsFor(ids){
  if (!ids.length) return new Map();
  const { data } = await sb.from("profile_stats").select("*").in("id", ids);
  return new Map((data || []).map(r => [r.id, r]));
}

PAGES.search = async () => {
  const q = (param("q") || "").trim(); const el = app();
  setTitle(q ? "Search: " + q : "Search");
  if (!q){ el.innerHTML = '<div class="pagehead"><h1>Search</h1></div><form action="/search/" method="get" style="display:flex;gap:8px;max-width:520px"><input class="input" name="q" placeholder="Search videos, channels and people" aria-label="Search"><button class="btn primary">Search</button></form>'; return; }
  const pat = "%" + q.replace(/[\\%_]/g, m => "\\" + m) + "%";
  const [v, p1, p2] = await Promise.all([
    sb.from("video_feed").select("*").ilike("title", pat).order("created_at", { ascending: false }).limit(60),
    sb.from("profiles").select(S.PROFILE_COLS).ilike("username", pat).limit(20),
    sb.from("profiles").select(S.PROFILE_COLS).ilike("display_name", pat).limit(20)
  ]);
  const vids = v.data || [];
  const all = [...new Map([...(p1.data || []), ...(p2.data || [])].map(p => [p.id, p])).values()];
  const chans = all.filter(isChannel), people = all.filter(p => !isChannel(p));
  let h = '<div class="pagehead"><h1>Results for “' + esc(q) + '”</h1></div>';
  if (!vids.length && !all.length){ el.innerHTML = h + empty("No matches", "Try a different word, or check the spelling."); return; }
  if (chans.length){ const stats = await statsFor(chans.map(c => c.id)); h += '<h2 style="font-size:18px;margin:0 0 10px">Channels</h2><div class="chlist" style="margin-bottom:26px">' + chans.map(c => chCard(c, stats.get(c.id))).join("") + '</div>'; }
  if (people.length) h += '<h2 style="font-size:18px;margin:0 0 10px">People</h2><div class="ulist" style="max-width:640px;margin-bottom:26px">' + people.map(p => personRow(p)).join("") + '</div>';
  if (vids.length){ const maps = await hydrate(vids); h += '<h2 style="font-size:18px;margin:0 0 10px">Videos</h2>' + grid(vids, maps); }
  el.innerHTML = h;
};

async function playlistCards(lists){
  if (!lists.length) return "";
  const items = must(await sb.from("playlist_items").select("playlist_id,video_id,added_at").in("playlist_id", lists.map(l => l.id)).order("added_at", { ascending: true }).limit(5000)) || [];
  const firstIds = [], counts = new Map(), first = new Map();
  items.forEach(i => { counts.set(i.playlist_id, (counts.get(i.playlist_id) || 0) + 1); if (!first.has(i.playlist_id)){ first.set(i.playlist_id, i.video_id); firstIds.push(i.video_id); } });
  const vids = new Map((await videosByIds([...new Set(firstIds)])).map(v => [v.id, v]));
  return '<div class="pllist">' + lists.map(l => {
    const n = counts.get(l.id) || 0, v = vids.get(first.get(l.id)), href = esc("/playlist/?p=" + encodeURIComponent(l.id));
    return '<article class="vcard plcard"><a class="thumb" href="' + href + '" data-count="' + plural(n, "video") + '" aria-label="Open playlist ' + esc(l.name) + '">' + (v ? thumbInner(v) : '<span class="ph" style="background:var(--surface-2);color:var(--muted)">≡</span>') + '</a><div class="vmeta"><div style="min-width:0"><a class="vtitle" href="' + href + '">' + esc(l.name) + '</a><div class="vsmall">Updated ' + esc(timeAgo(l.updated_at)) + '</div></div></div></article>';
  }).join("") + '</div>';
}
function newPlaylist(after){
  if (!S.requireAccount()) return;
  openModal('<h2>New playlist</h2><div class="field"><label for="plName">Name</label><input class="input" id="plName" maxlength="80"></div><div class="err" id="plErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="plGo">Create playlist</button></div>', m => {
    const go = async () => { const name = $("#plName", m).value.trim(); if (!name){ $("#plErr", m).textContent = "Give the playlist a name."; return; } $("#plGo", m).disabled = true;
      const r = await sb.from("playlists").insert({ owner_id: S.profile.id, name }).select().single();
      if (r.error){ $("#plErr", m).textContent = errText(r.error); $("#plGo", m).disabled = false; return; }
      closeModal(); toast("Playlist created"); if (after) after(r.data); };
    $("#plGo", m).addEventListener("click", go); $("#plName", m).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  });
}

PAGES.library = async () => {
  setTitle("Library"); const el = app();
  if (!S.signedIn()){ el.innerHTML = empty("Keep the videos you love", "Sign in to like videos and build playlists.", signInCta); return; }
  const [lists, likes, favs, clipsR] = await Promise.all([
    sb.from("playlists").select("*").eq("owner_id", S.profile.id).order("updated_at", { ascending: false }).limit(200),
    sb.from("likes").select("video_id").eq("profile_id", S.profile.id).order("created_at", { ascending: false }).limit(200),
    sb.from("favorites").select("video_id").eq("profile_id", S.profile.id).order("created_at", { ascending: false }).limit(200),
    sb.from("clips").select("*").eq("owner_id", S.profile.id).order("created_at", { ascending: false }).limit(100)
  ]);
  const liked = await videosByIds((likes.data || []).map(l => l.video_id)), faved = await videosByIds((favs.data || []).map(l => l.video_id));
  const clips = clipsR.data || [], clipVids = new Map((await videosByIds([...new Set(clips.map(c => c.video_id))])).map(v => [v.id, v]));
  const maps = await hydrate(liked.concat(faved, [...clipVids.values()]));
  const clipCard = c => { const v = clipVids.get(c.video_id); if (!v) return ""; const href = esc(watchUrl(v.id) + "&clip=" + encodeURIComponent(c.id));
    return '<article class="vcard"><a class="thumb" href="' + href + '" aria-label="Play clip">' + thumbInner(v) + '<span class="dur">' + S.clock(c.end_s - c.start_s) + '</span></a><div class="vmeta"><div style="min-width:0"><a class="vtitle" href="' + href + '">' + esc(c.title || v.title) + '</a><div class="vsmall">Clip ' + S.clock(c.start_s) + '–' + S.clock(c.end_s) + ' · <button class="linkbtn" data-delclip="' + esc(c.id) + '">Delete</button></div></div></div></article>'; };
  const pl = lists.data || [];
  el.innerHTML = '<div class="pagehead"><h1>Library</h1><button class="btn primary" id="newPl">New playlist</button></div><h2 style="font-size:19px;margin-bottom:14px">Playlists</h2>' +
    (pl.length ? await playlistCards(pl) : '<p class="vsmall">You haven\'t made a playlist yet. Use Save under any video, or create one here.</p>') +
    '<h2 style="font-size:19px;margin:34px 0 14px">Favorites</h2>' + (faved.length ? grid(faved, maps) : '<p class="vsmall">Tap Favorite under any video to keep it here.</p>') +
    '<h2 style="font-size:19px;margin:34px 0 14px">Your clips</h2>' + (clips.length ? '<div class="grid">' + clips.map(clipCard).join("") + '</div>' : '<p class="vsmall">Use Clip under any video to save a moment of up to 60 seconds.</p>') +
    '<h2 style="font-size:19px;margin:34px 0 14px">Liked videos</h2>' + (liked.length ? grid(liked, maps) : '<p class="vsmall">Videos you like will show up here.</p>');
  el.querySelectorAll("[data-delclip]").forEach(b => b.addEventListener("click", () => confirmModal("Delete this clip?", "Its link will stop working.", "Delete clip", async () => { must(await sb.from("clips").delete().eq("id", b.dataset.delclip)); PAGES.library(); })));
  $("#newPl").addEventListener("click", () => newPlaylist(p => { location.href = "/playlist/?p=" + encodeURIComponent(p.id); }));
};

PAGES.playlist = async () => {
  const el = app(), id = param("p");
  const pl = id ? (await sb.from("playlists").select("*").eq("id", id).maybeSingle()).data : null;
  if (!pl){ setTitle("Playlist"); el.innerHTML = notFound("Playlist"); return; }
  setTitle(pl.name);
  const [owner, itemsR] = await Promise.all([
    sb.from("profiles").select("id,username,display_name").eq("id", pl.owner_id).maybeSingle(),
    sb.from("playlist_items").select("video_id,added_at").eq("playlist_id", pl.id).order("added_at", { ascending: true }).limit(500)
  ]);
  let vids = await videosByIds((itemsR.data || []).map(i => i.video_id));
  const maps = await hydrate(vids), mine = S.signedIn() && pl.owner_id === S.profile.id, o = owner.data;
  const paint = () => {
    let h = '<div class="pagehead"><div><h1>' + esc(pl.name) + '</h1><div class="vsmall" style="margin-top:4px">' + (o ? 'By <a href="' + esc(profileUrl(o)) + '">' + esc(o.display_name || o.username) + '</a>, ' : "") + plural(vids.length, "video") + '</div></div><div class="acts">' +
      (vids.length ? '<a class="btn primary" href="' + esc(watchUrl(vids[0].id, pl.id)) + '">Play all</a>' : "") +
      (mine ? '<button class="btn ghost" id="plRename">Rename</button><button class="btn danger" id="plDelete">Delete playlist</button>' : "") + '</div></div>';
    if (!vids.length) h += empty("This playlist is empty", mine ? "Use Save under any video to add it here." : "Nothing has been added yet.");
    else h += '<div style="max-width:900px">' + vids.map((v, i) => { const c = maps.profiles.get(v.owner_id), href = esc(watchUrl(v.id, pl.id));
      return '<div class="plrow"><span class="n">' + (i + 1) + '</span><a class="thumb" href="' + href + '" aria-label="Play ' + esc(v.title) + '">' + thumbInner(v) + (v.duration ? '<span class="dur">' + fmtDur(v.duration) + '</span>' : "") + '</a><div style="min-width:0"><a class="vtitle" href="' + href + '">' + esc(v.title) + '</a><a class="vsub" href="' + (c ? esc(profileUrl(c)) : '#') + '">' + esc(S.displayName(c)) + '</a></div>' +
        (mine ? '<button class="btn sm ghost" data-rm="' + esc(v.id) + '">Remove</button>' : "<span></span>") + '</div>'; }).join("") + '</div>';
    el.innerHTML = h;
    if (mine){
      $("#plRename").addEventListener("click", () => openModal('<h2>Rename playlist</h2><div class="field"><label for="rnName">Name</label><input class="input" id="rnName" maxlength="80" value="' + esc(pl.name) + '"></div><div class="err" id="rnErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rnGo">Save</button></div>', m => {
        $("#rnGo", m).addEventListener("click", async () => { const name = $("#rnName", m).value.trim(); if (!name){ $("#rnErr", m).textContent = "Give the playlist a name."; return; }
          const r = await sb.from("playlists").update({ name, updated_at: new Date().toISOString() }).eq("id", pl.id); if (r.error){ $("#rnErr", m).textContent = errText(r.error); return; }
          pl.name = name; setTitle(name); closeModal(); paint(); toast("Playlist renamed"); });
      }));
      $("#plDelete").addEventListener("click", () => confirmModal("Delete playlist?", "“" + pl.name + "” will be deleted. The videos in it stay on The Stash.", "Delete playlist", async () => { must(await sb.from("playlists").delete().eq("id", pl.id)); location.href = "/library/"; }));
      el.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("playlist_items").delete().eq("playlist_id", pl.id).eq("video_id", b.dataset.rm); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } vids = vids.filter(v => v.id !== b.dataset.rm); paint(); toast("Removed from playlist"); }));
    }
  };
  paint();
};

/* ----- watch ----- */
const REPORT_REASONS = [["minor","Someone in it may be under 18"],["nonconsensual","Shared without consent, or private content"],["me_no_consent","I'm in this video and didn't agree to it"],["copyright","It's my work and was posted without permission"],["violence","Violence, abuse or something dangerous"],["spam","Spam or misleading"],["other","Something else"]];
function openReport(v){
  openModal('<h2>Report this video</h2><p class="lede">Reports go privately to The Stash team. If someone is in immediate danger, contact local emergency services.</p>' +
    '<fieldset class="field" style="border:0;padding:0;margin-top:12px"><legend style="font-weight:600;font-size:14px;margin-bottom:6px">What\'s wrong?</legend>' + REPORT_REASONS.map(([k, t], i) => '<label class="check"><input type="radio" name="rr" value="' + k + '"' + (i === 0 ? "" : "") + '><span>' + esc(t) + '</span></label>').join("") + '</fieldset>' +
    '<div class="field"><label for="rpD">Details <span class="hint">optional, up to 2000 characters</span></label><textarea id="rpD" maxlength="2000" style="min-height:80px"></textarea></div>' +
    (S.signedIn() ? "" : '<div class="field"><label for="rpC">Your email <span class="hint">optional, so we can follow up</span></label><input class="input" id="rpC" type="email" maxlength="200"></div>') +
    '<div class="err" id="rpErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rpGo">Send report</button></div>', m => {
    $("#rpGo", m).addEventListener("click", async () => {
      const r = m.querySelector('input[name="rr"]:checked'); if (!r){ $("#rpErr", m).textContent = "Pick what's wrong."; return; }
      $("#rpGo", m).disabled = true;
      const row = { video_id: v.id, video_title: v.title.slice(0, 100), reason: r.value, details: $("#rpD", m).value.trim().slice(0, 2000), contact: ($("#rpC", m) ? $("#rpC", m).value.trim() : "").slice(0, 200), reporter_id: S.signedIn() ? S.profile.id : null };
      const res = await sb.from("reports").insert(row);
      if (res.error){ $("#rpErr", m).textContent = errText(res.error, "The report didn't send. Try again."); $("#rpGo", m).disabled = false; return; }
      closeModal(); toast("Thanks. Your report was sent.");
    });
  });
}
function openShare(v, player){
  const base = location.origin + watchUrl(v.id);
  const cur = Math.floor(player.currentTime || 0);
  openModal('<h2>Share</h2><div class="field"><label for="shU">Link</label><div class="xrow"><input class="input" id="shU" readonly><button class="btn primary" id="shCopy">Copy</button></div></div>' +
    (cur > 0 ? '<label class="check" style="border:0"><input type="checkbox" id="shT"><span>Start at ' + S.clock(cur) + '</span></label>' : "") +
    '<div class="acts" style="margin-top:12px"><a class="btn ghost" id="shX" target="_blank" rel="noopener">Post on X</a>' + (navigator.share ? '<button class="btn ghost" id="shN">More options…</button>' : "") + '</div>' +
    '<div class="foot"><button class="btn ghost" data-close>Done</button></div>', m => {
    const url = () => base + ($("#shT", m) && $("#shT", m).checked ? "&t=" + cur : "");
    const paint = () => { $("#shU", m).value = url(); $("#shX", m).href = "https://x.com/intent/post?text=" + encodeURIComponent(v.title) + "&url=" + encodeURIComponent(url()); };
    paint(); const t = $("#shT", m); if (t) t.addEventListener("change", paint);
    $("#shU", m).addEventListener("focus", e => e.target.select());
    $("#shCopy", m).addEventListener("click", async () => { try { await navigator.clipboard.writeText(url()); toast("Link copied"); } catch(e){ $("#shU", m).select(); document.execCommand && document.execCommand("copy"); toast("Link copied"); } });
    const n = $("#shN", m); if (n) n.addEventListener("click", () => navigator.share({ title: v.title, url: url() }).catch(() => {}));
  });
}
function openClip(v, player){
  if (!S.requireAccount()) return;
  const d = isFinite(player.duration) ? player.duration : 0;
  if (!d){ toast("Wait for the video to load, then try again."); return; }
  let start = Math.max(0, Math.min(player.currentTime || 0, d - 1)), len = Math.min(15, Math.max(1, Math.floor(d - start)));
  openModal('<h2>Make a clip</h2><p class="lede">Clips are 1 to 60 seconds and get their own link. They start where the video is now.</p>' +
    '<div class="row2"><div class="field"><label for="clS">Starts at</label><input class="input" id="clS" value="' + S.clock(start) + '"></div><div class="field"><label for="clL">Length: <b id="clLv">' + len + 's</b></label><input type="range" id="clL" min="1" max="60" value="' + len + '" style="width:100%"></div></div>' +
    '<div class="field"><label for="clT">Title <span class="hint">optional</span></label><input class="input" id="clT" maxlength="100" placeholder="' + esc(v.title) + '"></div>' +
    '<p class="vsmall" id="clInfo"></p><div class="err" id="clErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="clGo">Save clip</button></div>', m => {
    const info = () => { const s = parseTime($("#clS", m).value), l = +$("#clL", m).value; $("#clLv", m).textContent = l + "s"; $("#clInfo", m).textContent = isNaN(s) || s == null ? "" : "From " + S.clock(s) + " to " + S.clock(Math.min(d, s + l)) + "."; };
    $("#clS", m).addEventListener("input", info); $("#clL", m).addEventListener("input", info); info();
    $("#clGo", m).addEventListener("click", async () => {
      const s = parseTime($("#clS", m).value), l = +$("#clL", m).value, err = $("#clErr", m);
      if (s == null || isNaN(s) || s < 0 || s >= d){ err.textContent = "Enter a start time inside the video, like 1:05."; return; }
      const e = Math.min(d, s + l); if (e - s < 1){ err.textContent = "Clips need to be at least 1 second."; return; }
      $("#clGo", m).disabled = true;
      const r = await sb.from("clips").insert({ video_id: v.id, owner_id: S.profile.id, title: $("#clT", m).value.trim().slice(0, 100), start_s: Math.round(s * 10) / 10, end_s: Math.round(e * 10) / 10 }).select().single();
      if (r.error){ err.textContent = errText(r.error, "The clip didn't save. Try again."); $("#clGo", m).disabled = false; return; }
      const link = location.origin + watchUrl(v.id) + "&clip=" + encodeURIComponent(r.data.id);
      m.innerHTML = '<h2>Clip saved</h2><p class="lede">It\'s in your Library under Your clips.</p><div class="field"><label for="clU">Clip link</label><div class="xrow"><input class="input" id="clU" readonly value="' + esc(link) + '"><button class="btn primary" id="clCopy">Copy</button></div></div><div class="foot"><a class="btn ghost" href="' + esc(watchUrl(v.id) + "&clip=" + encodeURIComponent(r.data.id)) + '">Watch clip</a><button class="btn primary" data-close>Done</button></div>';
      $("#clCopy", m).addEventListener("click", async () => { try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch(x){ $("#clU", m).select(); } });
    });
  });
}
function openEditVideo(v, ctx){
  const { player, tags, onSaved } = ctx;
  Promise.all([loadCategories(), sb.from("video_actions").select("*").eq("video_id", v.id).order("action_time")]).then(([cats, actionsResult]) => {
    const actions = must(actionsResult) || [];
    if (!actions.length && v.action_time != null) actions.push({ name: "Jump to action", action_time: v.action_time });
    const categoryIds = Array.isArray(v.category_ids) && v.category_ids.length ? v.category_ids : (v.category_id ? [v.category_id] : []);
    openModal('<h2>Edit video</h2>' +
    '<div class="field"><label for="evTitle">Title</label><input class="input" id="evTitle" maxlength="100" value="' + esc(v.title) + '"></div>' +
    '<div class="field"><label>Categories</label>' + categoryPicker("evCats", cats, categoryIds) + '</div>' +
    '<div class="field"><label>Jump to actions <span class="hint">optional</span></label>' + actionEditor("evActions", actions) + '</div>' +
    '<div class="field"><label>Models <span class="hint">optional</span></label><div id="evModels"></div></div>' +
    '<div class="field"><label>Thumbnail</label><div class="thumbpick"><div class="tp" id="evTp">' + (v.thumb_path ? '<img src="' + esc(S.pub("images", v.thumb_path)) + '" alt="Current thumbnail">' : "No thumbnail yet") + '</div><div><div class="tbtns"><button class="btn sm ghost" id="evFrame" type="button">Use the frame showing now</button><label class="btn sm ghost" style="cursor:pointer">Upload an image<input type="file" id="evImg" accept="image/png,image/jpeg,image/webp" class="sr"></label></div><p class="vsmall" style="margin-top:6px">Pause the video on the moment you want, then use that frame.</p></div></div></div>' +
    '<div class="err" id="evErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="evSave">Save changes</button></div>', m => {
    const mp = modelPicker($("#evModels", m), tags.map(t => ({ ...t.profile, _status: t.status })));
    wireActionEditor($("#evActions", m), player);
    let newThumb = null, tUrl = null;
    const showT = () => { if (tUrl) URL.revokeObjectURL(tUrl); tUrl = URL.createObjectURL(newThumb); $("#evTp", m).innerHTML = '<img src="' + tUrl + '" alt="New thumbnail">'; };
    $("#evFrame", m).addEventListener("click", async () => { const b = await S.frameFromVideo(player); if (!b){ $("#evErr", m).textContent = "That frame couldn't be read. Play the video for a moment, pause it, and try again."; return; } newThumb = b; showT(); $("#evErr", m).textContent = ""; });
    $("#evImg", m).addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { newThumb = await S.cropImage(f, 1280, 720); showT(); } catch(x){ $("#evErr", m).textContent = x.message; } });
    $("#evSave", m).addEventListener("click", async () => {
      const err = $("#evErr", m), title = $("#evTitle", m).value.trim();
      const category_ids = [...$("#evCats", m).querySelectorAll("input:checked")].map(i => i.value);
      const parsed = readActions($("#evActions", m), isFinite(player.duration) ? player.duration : Infinity);
      if (!title){ err.textContent = "Add a title."; return; }
      if (parsed.error){ err.textContent = parsed.error; return; }
      const b = $("#evSave", m); b.disabled = true; b.innerHTML = '<span class="spin"></span>Saving…';
      try {
        const upd = { title, category_id: category_ids[0] || null, action_time: parsed.actions[0] ? parsed.actions[0].action_time : null };
        let oldThumb = null;
        if (newThumb){ const p = S.user.id + "/thumb-" + v.id + "-" + Date.now() + ".jpg"; must(await sb.storage.from("images").upload(p, newThumb, { contentType: "image/jpeg" })); oldThumb = v.thumb_path; upd.thumb_path = p; }
        must(await sb.from("videos").update(upd).eq("id", v.id));
        await syncVideoCategories(v.id, category_ids, categoryIds);
        await syncVideoActions(v.id, parsed.actions);
        await syncModelTags(v.id, mp.ids(), tags.map(t => t.model_id));
        if (oldThumb) sb.storage.from("images").remove([oldThumb]).then(() => {});
        closeModal(); toast("Video saved"); onSaved();
      } catch(e){ err.textContent = errText(e, "Your changes didn't save. Try again."); b.disabled = false; b.textContent = "Save changes"; }
    });
  });
  });
}

PAGES.watch = async () => {
  const el = app(), id = param("v"), listId = param("list"), clipId = param("clip");
  const v = id ? (await sb.from("video_feed").select("*").eq("id", id).maybeSingle()).data : null;
  if (!v){ setTitle("Video"); el.innerHTML = empty("This video isn't available", "It may have been removed by its creator.", '<a class="btn primary" href="/">Go home</a>'); return; }
  setTitle(v.title);
  const [owR, st, tagR, cats, clipR, mine2, actionR] = await Promise.all([
    sb.from("profiles").select("*").eq("id", v.owner_id).maybeSingle(), myState(),
    sb.from("video_models").select("*").eq("video_id", v.id), loadCategories(),
    clipId ? sb.from("clips").select("*").eq("id", clipId).eq("video_id", v.id).maybeSingle() : { data: null }, null,
    sb.from("video_actions").select("*").eq("video_id", v.id).order("action_time")
  ]);
  const owner = owR.data || { id: v.owner_id, username: "unknown", kind: "personal" };
  const clip = clipR.data;
  const tagRows = tagR.data || [], tagProfiles = await profilesByIds(tagRows.map(t => t.model_id));
  let tags = tagRows.map(t => ({ ...t, profile: tagProfiles.get(t.model_id) })).filter(t => t.profile);
  const categoryIds = Array.isArray(v.category_ids) && v.category_ids.length ? v.category_ids : (v.category_id ? [v.category_id] : []);
  const categories = cats.filter(c => categoryIds.includes(c.id));
  const actions = must(actionR) || [];
  if (!actions.length && v.action_time != null) actions.push({ name: "Jump to action", action_time: v.action_time });
  const [ownerStats, manager] = await Promise.all([ profileStats(owner.id), isChannel(owner) && !owner.user_id ? managerOf(owner) : null ]);
  const mgrStats = manager ? await profileStats(manager.id) : null;
  let likeCount = v.like_count || 0, liked = st.likes.has(v.id), disliked = st.dislikes.has(v.id), faved = st.favs.has(v.id);
  const counts = { [owner.id]: isChannel(owner) ? ownerStats.subscribers : ownerStats.followers };
  if (manager) counts[manager.id] = mgrStats.followers;
  const mine = S.manages(owner.id);
  let theater = S.lsGet("stash:theater") === "1";

  el.innerHTML = '<div class="watch' + (theater ? " theater" : "") + '" id="watchGrid"><div class="wmain"><div id="player"></div>' +
    (clip ? '<div class="clipnote">You\'re watching a clip' + (clip.title ? ': <b>' + esc(clip.title) + '</b>' : "") + '. <a href="' + esc(watchUrl(v.id)) + '">Watch the full video</a></div>' : "") +
    '<h1 class="wtitle"></h1><div class="wsub" id="w-sub"></div><div id="w-models"></div><div id="w-meta"></div>' +
    '<section class="related" id="w-related" aria-labelledby="relH"></section>' +
    '<section class="comments" aria-labelledby="w-ccount"><h2 id="w-ccount">Comments</h2><div id="w-composer"></div><div id="w-clist"><div class="vsmall">Loading comments…</div></div></section></div><aside class="wside" id="w-next" aria-label="Recommended"></aside></div>';
  $(".wtitle", el).textContent = clip && clip.title ? clip.title : v.title;
  if (param("thumbfail") === "1") toast("The video published, but its thumbnail didn't upload. Use Edit to add one.");
  if (param("tagfail") === "1") toast("The video uploaded, but its model tags didn't save. Use Edit to manage tags.");
  const live = (!tags.length || tags.some(t => t.status === "approved")) && !tags.some(t => t.status === "pending");
  if (!live){
    const waiting = tags.filter(t => t.status === "pending").map(t => "@" + t.profile.username);
    const box = document.createElement("div"); box.className = "notice pendingbox"; box.setAttribute("role", "status");
    box.innerHTML = '<b>Only you can see this video for now.</b> ' + (waiting.length ? "It goes public once " + esc(waiting.join(", ")) + (waiting.length === 1 ? " approves" : " approve") + " being tagged." : "It goes public once a tagged model approves. Use Edit to manage model tags.");
    $(".wmain", el).insertBefore(box, $(".wmain", el).firstChild);
  }

  let nextUrl = null, nextTitle = "", inPlaylist = false, upTimer = null;
  const autoplayOn = () => S.lsGet("stash:autoplay") !== "0";
  const cancelUpNext = () => { clearInterval(upTimer); upTimer = null; const o = $("#upnext"); if (o) o.remove(); };
  const goNext = () => { if (nextUrl) location.href = nextUrl + (nextUrl.includes("?") ? "&" : "?") + "autoplay=1"; };
  const streamCustomerCode = String(S.cfg.STREAM_CUSTOMER_CODE || "").trim();
  const sources = (v.stream_uid && streamCustomerCode ? [{ src: "https://customer-" + encodeURIComponent(streamCustomerCode) + ".cloudflarestream.com/" + encodeURIComponent(v.stream_uid) + "/manifest/video.m3u8", label: "Auto", hls: true }] : [])
    .concat(v.video_path ? [{ src: S.pub("videos", v.video_path), label: "" }] : [])
    .concat((Array.isArray(v.sources) ? v.sources : []).filter(x => x && x.path).map(x => ({ src: S.pub("videos", x.path), label: String(x.label || "").slice(0, 12) })));
  if (v.stream_uid && !streamCustomerCode) toast("Cloudflare Stream playback isn't configured. Set STREAM_CUSTOMER_CODE in assets/config.js.");
  const startAt = clip ? clip.start_s : (parseFloat(param("t")) > 0 ? parseFloat(param("t")) : 0);
  const P = S.mountPlayer($("#player"), {
    sources, poster: v.thumb_path ? S.pub("images", v.thumb_path) : "", startAt,
    actionTime: actions.length ? actions[0].action_time : (v.action_time || null), clip: clip ? { start: clip.start_s, end: clip.end_s } : null, theater,
    onTheater: on => { theater = on; S.lsSet("stash:theater", on ? "1" : "0"); $("#watchGrid").classList.toggle("theater", on); },
    onNext: () => { if (nextUrl) goNext(); else toast("There's nothing up next yet."); },
    onEnded: () => {
      if (!nextUrl || clip) return;
      if (inPlaylist){ goNext(); return; }
      if (!autoplayOn()) return;
      let n = 5; const box = document.createElement("div"); box.className = "upnext"; box.id = "upnext";
      box.innerHTML = '<span class="vsmall" style="color:#cfd3e6">Up next in <b id="upn">5</b></span><div class="ttl"></div><div class="acts"><button class="btn ghost" id="upCancel" style="color:#fff;border-color:rgba(255,255,255,.4)">Cancel</button><button class="btn primary" id="upGo">Play now</button></div>';
      box.querySelector(".ttl").textContent = nextTitle;
      $("#player").appendChild(box);
      $("#upCancel").addEventListener("click", cancelUpNext); $("#upGo").addEventListener("click", goNext); $("#upGo").focus();
      upTimer = setInterval(() => { n--; const c = $("#upn"); if (c) c.textContent = String(n); if (n <= 0){ cancelUpNext(); goNext(); } }, 1000);
    }
  });
  const player = P.video;
  player.addEventListener("play", cancelUpNext);
  if (param("autoplay") === "1" || clip) P.play();

  const sub = () => {
    $("#w-sub").innerHTML = '<span>' + esc(timeAgo(v.created_at)) + '</span>' + categories.map(c => '<a class="catchip" href="' + esc(catUrl(c)) + '">' + esc(c.name) + '</a>').join("") +
      actions.map((a, i) => '<button class="linkbtn" data-jump-action="' + i + '">⚡ ' + esc(a.name) + ' (' + S.clock(a.action_time) + ')</button>').join("");
    $("#w-sub").querySelectorAll("[data-jump-action]").forEach(b => b.addEventListener("click", () => { const a = actions[+b.dataset.jumpAction]; P.seekTo(a.action_time); P.play(); }));
  };
  const modelsRow = () => {
    const shown = tags.filter(t => t.status === "approved" || mine || (S.signedIn() && t.model_id === S.profile.id));
    if (!shown.length){ $("#w-models").innerHTML = ""; return; }
    $("#w-models").innerHTML = '<div class="models"><span class="mlabel">' + (shown.filter(t => t.status === "approved").length === 1 ? "Model" : "Models") + '</span>' + shown.map(t => {
      const p = t.profile, pending = t.status !== "approved", isMeModel = S.signedIn() && t.model_id === S.profile.id;
      return '<span class="mcard' + (pending ? " pending" : "") + '"><a href="' + esc(profileUrl(p)) + '">' + avatar(p, 36) + '<span><b>' + esc(displayName(p)) + '</b><small>@' + esc(p.username) + '</small></span></a>' +
        (pending && isMeModel ? '<span class="macts"><button class="btn sm primary" data-tagok="' + esc(t.model_id) + '">Approve tag</button><button class="btn sm ghost" data-tagno="' + esc(t.model_id) + '">Decline</button></span>' : pending ? '<em>waiting for approval</em>' : "") + '</span>';
    }).join("") + '</div>';
    $("#w-models").querySelectorAll("[data-tagok]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("video_models").update({ status: "approved" }).eq("video_id", v.id).eq("model_id", b.dataset.tagok); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } tags = tags.map(t => t.model_id === b.dataset.tagok ? { ...t, status: "approved" } : t); modelsRow(); toast("You're now shown in this video"); }));
    $("#w-models").querySelectorAll("[data-tagno]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("video_models").delete().eq("video_id", v.id).eq("model_id", b.dataset.tagno); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } tags = tags.filter(t => t.model_id !== b.dataset.tagno); modelsRow(); toast("Tag removed"); }));
  };
  const whoBlock = (p, big) => {
    const n = counts[p.id] || 0, label = isChannel(p) ? plural(n, "subscriber") : plural(n, "follower");
    return '<div class="who"><a href="' + esc(profileUrl(p)) + '" aria-label="Open ' + esc(displayName(p)) + '">' + avatar(p, big ? 42 : 36) + '</a><span style="min-width:0"><a class="name" href="' + esc(profileUrl(p)) + '">' + nameLine(p) + '</a><span class="sub">@' + esc(p.username) + ', ' + label + '</span></span>' +
      (relationBtn(p, st, big ? "" : "sm") ? '<span style="margin-left:6px">' + relationBtn(p, st, big ? "" : "sm") + '</span>' : "") + '</div>';
  };
  const ICO = {
    like: f => '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (f ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 10v11H3V10zM7 10l4-7a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7"/></svg>',
    dislike: f => '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (f ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M7 10v11H3V10zM7 10l4-7a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7"/></svg>',
    fav: f => '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (f ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    save: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 11h12M4 16h7M18 13v8M14 17h8"/></svg>',
    clip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5l6 6-6 6M20 11h-9a7 7 0 0 0-7 7"/></svg>',
    flag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>'
  };
  const meta = () => {
    $("#w-meta").innerHTML = '<div class="wrow"><div class="who-row">' + whoBlock(owner, true) + (manager ? whoBlock(manager, false) : "") + '</div></div>' +
      '<div class="actrow" role="group" aria-label="Video actions">' +
        '<div class="seg2"><button class="btn' + (liked ? " liked" : "") + '" id="likeBtn" aria-pressed="' + liked + '" aria-label="Like, ' + likeCount + ' likes">' + ICO.like(liked) + fmtCount(likeCount) + '</button><button class="btn' + (disliked ? " on2" : "") + '" id="disBtn" aria-pressed="' + disliked + '" aria-label="Dislike">' + ICO.dislike(disliked) + '</button></div>' +
        '<button class="btn' + (faved ? " fav" : "") + '" id="favBtn" aria-pressed="' + faved + '">' + ICO.fav(faved) + (faved ? "Favorited" : "Favorite") + '</button>' +
        '<button class="btn" id="saveBtn">' + ICO.save + 'Save</button><button class="btn" id="clipBtn">' + ICO.clip + 'Clip</button><button class="btn" id="shareBtn">' + ICO.share + 'Share</button><button class="btn" id="repBtn">' + ICO.flag + 'Report</button>' +
        (mine || S.isFounder() ? (mine ? '<button class="btn ghost" id="editBtn">Edit</button>' : "") + '<button class="btn danger" id="delBtn">Delete</button>' : "") + '</div>';
    $("#w-meta").querySelectorAll("[data-rel]").forEach(b => b.addEventListener("click", async () => {
      const p = b.dataset.rel === owner.id ? owner : manager; b.disabled = true;
      const r = await handleRel(p, st); if (r != null) counts[p.id] = Math.max(0, (counts[p.id] || 0) + (r ? 1 : -1)); meta();
    }));
    const toggleRow = async (table, on) => { const me = S.profile.id; return on ? await sb.from(table).insert({ profile_id: me, video_id: v.id }) : await sb.from(table).delete().eq("profile_id", me).eq("video_id", v.id); };
    $("#likeBtn").addEventListener("click", async e => {
      if (!S.requireAccount()) return; e.currentTarget.disabled = true;
      const on = !liked, res = await toggleRow("likes", on);
      if (res.error && res.error.code !== "23505") toast(errText(res.error)); else { liked = on; likeCount = Math.max(0, likeCount + (on ? 1 : -1)); if (on && disliked){ await toggleRow("dislikes", false); disliked = false; } }
      meta();
    });
    $("#disBtn").addEventListener("click", async e => {
      if (!S.requireAccount()) return; e.currentTarget.disabled = true;
      const on = !disliked, res = await toggleRow("dislikes", on);
      if (res.error && res.error.code !== "23505") toast(errText(res.error)); else { disliked = on; if (on && liked){ await toggleRow("likes", false); liked = false; likeCount = Math.max(0, likeCount - 1); } }
      meta();
    });
    $("#favBtn").addEventListener("click", async e => {
      if (!S.requireAccount()) return; e.currentTarget.disabled = true;
      const on = !faved, res = await toggleRow("favorites", on);
      if (res.error && res.error.code !== "23505") toast(errText(res.error)); else { faved = on; toast(on ? "Added to Favorites" : "Removed from Favorites"); }
      meta();
    });
    $("#saveBtn").addEventListener("click", () => openSave(v.id));
    $("#clipBtn").addEventListener("click", () => openClip(v, player));
    $("#shareBtn").addEventListener("click", () => openShare(v, player));
    $("#repBtn").addEventListener("click", () => openReport(v));
    const eb = $("#editBtn"); if (eb) eb.addEventListener("click", () => openEditVideo(v, { player, tags, onSaved: () => location.reload() }));
    const db = $("#delBtn"); if (db) db.addEventListener("click", () => confirmModal("Delete this video?", "“" + v.title + "” will be removed from The Stash for everyone, along with its comments, likes and clips. This can't be undone.", "Delete video", async () => {
      if (mine && v.stream_uid) await S.deleteStreamVideo(v.stream_uid);
      must(await sb.from("videos").delete().eq("id", v.id));
      if (mine){ const paths = [v.video_path].concat((v.sources || []).map(x => x.path).filter(Boolean)).filter(Boolean); if (paths.length) sb.storage.from("videos").remove(paths).then(() => {}); if (v.thumb_path) sb.storage.from("images").remove([v.thumb_path]).then(() => {}); }
      location.href = profileUrl(owner);
    }));
  };
  sub(); modelsRow(); meta();

  // comments
  let comments = [], authors = new Map();
  const loadComments = async () => {
    comments = must(await sb.from("comments").select("*").eq("video_id", v.id).order("created_at", { ascending: false }).limit(500)) || [];
    const m = await profilesByIds(comments.map(c => c.author_id).filter(i => !authors.has(i))); m.forEach((p, k) => authors.set(k, p));
    paintComments();
  };
  const paintComments = () => {
    $("#w-ccount").textContent = plural(comments.length, "comment");
    const list = $("#w-clist");
    if (!comments.length){ list.innerHTML = '<div class="vsmall">No comments yet. Start the conversation.</div>'; return; }
    list.innerHTML = comments.map(c => { const p = authors.get(c.author_id) || { id: c.author_id, username: "unknown" }; const canDel = S.signedIn() && (c.author_id === S.profile.id || mine || S.isFounder());
      return '<div class="comment"><a href="' + esc(profileUrl(p)) + '" aria-label="Open profile">' + avatar(p, 36) + '</a><div style="min-width:0;flex:1"><div class="head"><a href="' + esc(profileUrl(p)) + '" style="font-weight:600">@' + esc(p.username) + '</a>' + badges(p) + '<span>' + esc(timeAgo(c.created_at)) + '</span></div><p>' + esc(c.body) + '</p>' + (canDel ? '<button class="del" data-del="' + esc(c.id) + '">Delete</button>' : "") + '</div></div>'; }).join("");
  };
  $("#w-clist").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (!b) return; confirmModal("Delete comment?", "This removes the comment for everyone.", "Delete", async () => { must(await sb.from("comments").delete().eq("id", b.dataset.del)); comments = comments.filter(c => c.id !== b.dataset.del); paintComments(); }); });
  if (S.signedIn()){
    $("#w-composer").innerHTML = '<div class="composer">' + avatar(S.profile, 38) + '<div style="flex:1"><label class="sr" for="cText">Add a comment</label><textarea id="cText" maxlength="2000" placeholder="Add a comment…" rows="1"></textarea><div class="cbar"><button class="btn primary sm" id="cPost">Comment</button></div></div></div>';
    $("#cPost").addEventListener("click", async () => {
      const ta = $("#cText"), body = ta.value.trim(), b = $("#cPost"); if (!body){ ta.focus(); return; }
      b.disabled = true;
      const r = await sb.from("comments").insert({ video_id: v.id, author_id: S.profile.id, body: body.slice(0, 2000) }).select().single();
      b.disabled = false;
      if (r.error){ toast(errText(r.error, "Your comment didn't post. Try again.")); return; }
      ta.value = ""; authors.set(S.profile.id, S.profile); comments.unshift(r.data); paintComments();
    });
  } else $("#w-composer").innerHTML = '<div class="notice">Sign in to join the conversation. <a class="btn primary sm" href="/login/?mode=signup" data-auth="signup" style="margin-left:8px">Sign up</a></div>';
  loadComments().catch(() => { $("#w-clist").innerHTML = '<div class="vsmall">Comments couldn\'t load. Reload the page to try again.</div>'; });

  // related: same models or category
  (async () => {
    const approvedModels = tags.filter(t => t.status === "approved").map(t => t.model_id);
    const [byModel, byCat, byOwner] = await Promise.all([
      approvedModels.length ? sb.from("video_models").select("video_id").in("model_id", approvedModels).eq("status", "approved").neq("video_id", v.id).limit(40) : { data: [] },
      categoryIds.length ? sb.from("video_feed").select("*").overlaps("category_ids", categoryIds).neq("id", v.id).order("created_at", { ascending: false }).limit(12) : { data: [] },
      sb.from("video_feed").select("*").eq("owner_id", v.owner_id).neq("id", v.id).order("created_at", { ascending: false }).limit(8)
    ]);
    const modelVids = await videosByIds([...new Set((byModel.data || []).map(r => r.video_id))].slice(0, 12));
    const rel = [...new Map([...modelVids, ...(byCat.data || []), ...(byOwner.data || [])].map(x => [x.id, x])).values()].slice(0, 8);
    if (!rel.length){ $("#w-related").innerHTML = ""; return; }
    const maps = await hydrate(rel);
    $("#w-related").innerHTML = '<h2 id="relH">Related</h2><div class="grid relgrid">' + rel.map(x => vcard(x, maps)).join("") + '</div>';
  })().catch(() => { $("#w-related").innerHTML = ""; });

  // playlist panel and recommended
  (async () => {
    let h = "";
    if (listId){
      const pl = (await sb.from("playlists").select("id,name").eq("id", listId).maybeSingle()).data;
      if (pl){
        const items = must(await sb.from("playlist_items").select("video_id").eq("playlist_id", pl.id).order("added_at", { ascending: true }).limit(500)) || [];
        const pv = await videosByIds(items.map(i => i.video_id)), ids = pv.map(x => x.id), idx = ids.indexOf(v.id);
        h += '<div class="plpanel"><h3><a href="/playlist/?p=' + esc(encodeURIComponent(pl.id)) + '">' + esc(pl.name) + '</a></h3><div class="vsmall" style="margin-bottom:8px">' + (idx + 1) + ' of ' + pv.length + '</div>' +
          pv.map(x => '<a class="item' + (x.id === v.id ? " cur" : "") + '" href="' + esc(watchUrl(x.id, pl.id)) + '"><span class="thumb">' + thumbInner(x) + '</span><span class="vtitle" style="font-size:13.5px">' + esc(x.title) + '</span></a>').join("") + '</div>';
        if (idx >= 0 && idx < ids.length - 1){ nextUrl = watchUrl(ids[idx + 1], pl.id); nextTitle = pv[idx + 1].title; inPlaylist = true; }
      }
    }
    const follows = [...st.subs, ...st.follows];
    const [same, latest, popular, network] = await Promise.all([
      sb.from("video_feed").select("*").eq("owner_id", v.owner_id).neq("id", v.id).order("created_at", { ascending: false }).limit(10),
      sb.from("video_feed").select("*").neq("id", v.id).order("created_at", { ascending: false }).limit(30),
      sb.from("video_feed").select("*").neq("id", v.id).order("like_count", { ascending: false }).limit(20),
      follows.length ? sb.from("video_feed").select("*").in("owner_id", follows.slice(0, 100)).neq("id", v.id).order("created_at", { ascending: false }).limit(20) : { data: [] }
    ]);
    const pool = new Map(); [same, latest, popular, network].forEach(r => (r.data || []).forEach(x => pool.set(x.id, x)));
    const fset = new Set(follows), now = Date.now();
    const words = new Set(String(v.title).toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const scored = [...pool.values()].map(x => {
      let sc = 0;
      if (x.owner_id === v.owner_id) sc += 4;
      if (fset.has(x.owner_id)) sc += 3;
      if (categoryIds.some(id => (x.category_ids || [x.category_id]).includes(id))) sc += 2;
      sc += Math.log2(1 + (x.like_count || 0)) * 0.9 - Math.log2(1 + (x.dislike_count || 0)) * 0.5;
      sc += 2 * Math.exp(-((now - Date.parse(x.created_at)) / 86400000) / 14);
      String(x.title).toLowerCase().split(/\W+/).forEach(w => { if (words.has(w)) sc += 1.2; });
      if (st.likes.has(x.id)) sc -= 1;
      return { x, sc: sc + Math.random() * 0.6 };
    }).sort((a, b) => b.sc - a.sc).slice(0, 20).map(o => o.x);
    if (!inPlaylist && scored.length){ nextUrl = watchUrl(scored[0].id); nextTitle = scored[0].title; }
    const maps = await hydrate(scored);
    h += '<div class="rechead"><h2>Recommended</h2>' + (inPlaylist ? "" : '<label class="toggle"><input type="checkbox" id="autoT"' + (autoplayOn() ? " checked" : "") + '><span class="sw" aria-hidden="true"></span>Autoplay</label>') + '</div>' +
      (scored.length ? '<div class="nextlist">' + scored.map(x => vcard(x, maps, { compact: true })).join("") + '</div>' : '<p class="vsmall">Nothing else in the stash yet.</p>');
    $("#w-next").innerHTML = h;
    const at = $("#autoT"); if (at) at.addEventListener("change", () => { S.lsSet("stash:autoplay", at.checked ? "1" : "0"); if (!at.checked) cancelUpNext(); });
  })().catch(() => { $("#w-next").innerHTML = ""; });
};

/* ----- upload ----- */
PAGES.upload = async () => {
  setTitle("Upload"); const el = app();
  if (!S.signedIn()){ el.innerHTML = empty("Sign in to upload", "Uploading is for verified models. Sign in, then apply from the Model tab on your profile.", signInCta); return; }
  if (!S.canUpload()){ el.innerHTML = empty("Uploading is for verified models", "To keep everyone on The Stash safe, only creators whose age and ID we've checked can upload. Apply from your profile and you can start once you're approved.", '<a class="btn primary" href="' + esc(profileUrl(S.profile)) + '&tab=model">Apply to be a model</a>'); return; }
  const MAXMB = +S.cfg.MAX_VIDEO_MB || 50;
  const cats = await loadCategories();
  const maxLabel = MAXMB >= 1048576 ? +(MAXMB / 1048576).toFixed(1) + " TB" : MAXMB >= 1024 ? +(MAXMB / 1024).toFixed(1) + " GB" : MAXMB + " MB";
  const targets = S.postAs();
  const want = param("to");
  let source = param("from") === "x" ? "x" : "device";
  el.innerHTML = '<div class="upwrap"><div class="pagehead"><h1>Upload a video</h1></div>' +
    '<div id="picker"><div class="srctabs" role="tablist" aria-label="Where the video comes from"><button role="tab" data-src="device">From your device</button><button role="tab" data-src="x">From X</button></div><div id="srcPane"></div></div>' +
    '<div id="upform" hidden><div class="preview"><video id="vprev" controls playsinline muted></video></div><div class="vsmall" id="vinfo" style="margin-top:6px"></div>' +
    '<div class="field"><label for="vtitle">Title <span class="hint">(required)</span></label><input class="input" id="vtitle" maxlength="100"></div>' +
    '<div class="field"><label>Categories <span class="hint">optional; select all that apply</span></label>' + categoryPicker("vcats", cats, param("cat") ? (cats.find(c => c.slug === param("cat")) || {}).id : "") + '</div>' +
    '<div class="field"><label>Jump to actions <span class="hint">optional; each action needs a name and time</span></label>' + actionEditor("vactions", []) + '</div>' +
    '<div class="field"><label>Models <span class="hint">optional. Every model you tag must approve before the video goes public.</span></label><div id="vmodels"></div></div>' +
    '<div class="field"><label for="vto">Post to</label><select id="vto">' + targets.map(t => '<option value="' + esc(t.id) + '">' + esc(displayName(t)) + ' (@' + esc(t.username) + ')' + (isChannel(t) ? ", channel" : ", your profile") + '</option>').join("") + '</select>' +
      (targets.some(isChannel) ? "" : '<p class="vsmall" style="margin:6px 0 0">Videos post to your profile, where people can follow you.</p>') + '</div>' +
    '<div class="field"><label>Thumbnail <span class="hint">picked from a random moment in your video</span></label><div class="thumbpick"><div class="tp" id="tprev">Choosing a frame…</div><div><div class="vsmall" id="tinfo"></div><div class="tbtns"><button class="btn sm ghost" id="tShuffle" disabled>Pick another moment</button><label class="btn sm ghost" style="cursor:pointer">Upload an image<input type="file" id="vthumb" accept="image/png,image/jpeg,image/webp" class="sr"></label></div></div></div></div>' +
    '<fieldset class="consent"><legend>Before you publish</legend>' +
      '<label class="check"><input type="checkbox" id="cs1"><span>Everyone who appears in this video was 18 or older when it was filmed.</span></label>' +
      '<label class="check"><input type="checkbox" id="cs2"><span>Everyone who appears agreed to be filmed and agreed to this video being published on The Stash.</span></label>' +
      '<label class="check"><input type="checkbox" id="cs3"><span>I own this video or have permission to post it, and I keep the age and consent records for everyone in it.</span></label></fieldset>' +
    '<div class="progress" id="prog" hidden><i></i></div><div class="vsmall" id="progText"></div><div class="err" id="uperr" role="alert"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn ghost" id="reset">Choose another video</button><button class="btn primary" id="pub">Publish</button></div></div></div>';
  if (want && targets.some(t => t.id === want)) $("#vto").value = want;
  let file = null, ftype = null, prevUrl = null, busy = false, grabber = null, thumb = null, thumbUrl = null, gen = 0, imported = null;
  const picker = modelPicker($("#vmodels"), S.profile.is_model ? [S.profile] : []);
  wireActionEditor($("#vactions"), $("#vprev"));

  const paintSource = () => {
    el.querySelectorAll("[data-src]").forEach(b => { const on = b.dataset.src === source; b.classList.toggle("cur", on); b.setAttribute("aria-selected", String(on)); });
    const pane = $("#srcPane");
    if (source === "device"){
      pane.innerHTML = '<div class="drop" id="drop"><h2 style="font-size:19px">Drop a video here</h2><p>Video formats supported by Cloudflare Stream, up to ' + maxLabel + '. Videos are converted for browser-compatible playback.</p><label class="btn primary" style="cursor:pointer">Choose file<input type="file" id="vfile" accept="' + esc(S.VIDEO_ACCEPT) + '" class="sr"></label></div>';
      const fi = $("#vfile"), drop = $("#drop");
      fi.addEventListener("change", () => { if (fi.files[0]) pick(fi.files[0]); fi.value = ""; });
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) pick(f); });
      return;
    }
    const xi = S.xIdentity(), xname = xi && xi.identity_data ? (xi.identity_data.user_name || xi.identity_data.preferred_username || "") : "";
    if (!xi){
      pane.innerHTML = '<div class="xbox"><h2>Import a video from X</h2><p>Paste a link to one of your X posts and its video comes straight here. First, connect your X account so The Stash knows which posts are yours.</p><button class="btn primary" id="xLink">Connect X account</button><div class="err" id="xErr" role="alert"></div></div>';
      $("#xLink").addEventListener("click", async () => { const b = $("#xLink"); b.disabled = true; try { await S.linkX("/upload/?from=x"); } catch(e){ b.disabled = false; $("#xErr").textContent = /manual linking|linking is disabled/i.test(e.message || "") ? "Connecting accounts isn't switched on for this site yet." : /provider is not enabled|Unsupported provider/i.test(e.message || "") ? "X sign-in isn't switched on for this site yet." : errText(e); } });
      return;
    }
    pane.innerHTML = '<div class="xbox"><h2>Import a video from X</h2><p>Paste a link to one of your posts' + (xname ? ' as <b>@' + esc(xname) + '</b>' : "") + '. You can only import videos from your own posts, up to ' + (S.cfg.MAX_X_IMPORT_MB || 512) + ' MB.</p>' +
      '<div class="xrow"><label class="sr" for="xUrl">Link to your X post</label><input class="input" id="xUrl" type="url" inputmode="url" placeholder="https://x.com/' + esc(xname || "you") + '/status/…" autocomplete="off"><button class="btn primary" id="xGo">Import video</button></div><div class="err" id="xErr" role="alert"></div></div>';
    const go = async () => {
      const link = $("#xUrl").value.trim(), b = $("#xGo"), errEl = $("#xErr");
      if (!/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(es)?\/\d+/i.test(link)){ errEl.textContent = "Paste a link to an X post, like https://x.com/you/status/123…"; return; }
      errEl.textContent = ""; b.disabled = true; b.innerHTML = '<span class="spin"></span>Importing…';
      try {
        const r = await S.importFromX(link);
        b.innerHTML = '<span class="spin"></span>Loading…';
        const res = await fetch(S.pub("videos", r.path));
        if (!res.ok) throw new Error("The imported video couldn't be opened. Try again.");
        const blob = await res.blob();
        const f = new File([blob], "x-post.mp4", { type: "video/mp4" });
        imported = { path: r.path, link };
        pick(f, { title: r.title, imported: true });
      } catch(e){ errEl.textContent = e.message || "The import didn't work. Try again."; }
      b.disabled = false; b.textContent = "Import video";
    };
    $("#xGo").addEventListener("click", go);
    $("#xUrl").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  };
  el.querySelectorAll("[data-src]").forEach(b => b.addEventListener("click", () => { source = b.dataset.src; paintSource(); }));

  const showThumb = () => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl); thumbUrl = null;
    const tp = $("#tprev"), ti = $("#tinfo");
    if (!thumb){ tp.textContent = "Your browser couldn't read a frame from this video, so pick an image for the thumbnail."; ti.textContent = ""; return; }
    thumbUrl = URL.createObjectURL(thumb.blob); tp.innerHTML = '<img src="' + thumbUrl + '" alt="Thumbnail preview">';
    ti.textContent = thumb.custom ? "Using your image." : "Frame from " + Math.floor(thumb.time / 60) + ":" + String(Math.floor(thumb.time % 60)).padStart(2, "0") + ". This stays as your thumbnail unless you change it.";
  };
  const pickFrame = async () => {
    if (!grabber) return; const my = ++gen; const sh = $("#tShuffle"); sh.disabled = true; $("#tprev").innerHTML = '<span class="spin"></span>';
    const r = await grabber.randomFrame(thumb && !thumb.custom ? thumb.time : null);
    if (my !== gen) return;
    if (r) thumb = { blob: r.blob, time: r.time, custom: false };
    showThumb(); sh.disabled = false;
  };
  const dropImported = () => { if (imported){ sb.storage.from("videos").remove([imported.path]).then(() => {}); imported = null; } };
  function pick(f, o){
    o = o || {};
    const type = S.videoType(f);
    if (!type){ toast("That doesn't look like a video file."); return; }
    if (f.size > MAXMB * 1048576){ toast("That video is " + (f.size / 1048576).toFixed(0) + " MB. The limit is " + maxLabel + "."); return; }
    ftype = type;
    if (!o.imported) dropImported();
    if (prevUrl) URL.revokeObjectURL(prevUrl); if (grabber) grabber.close();
    file = f; prevUrl = URL.createObjectURL(f); thumb = null; grabber = S.frameGrabber(f);
    $("#picker").hidden = true; $("#upform").hidden = false; $("#uperr").textContent = "";
    $("#vprev").src = prevUrl;
    const sizeTxt = f.size >= 1073741824 ? (f.size / 1073741824).toFixed(2) + " GB" : (f.size / 1048576).toFixed(1) + " MB";
    $("#vinfo").textContent = (o.imported ? "Imported from your X post, " : f.name + ", ") + sizeTxt;
    grabber.canPlay().then(ok => { if (!ok && file === f){ $("#vinfo").innerHTML = esc($("#vinfo").textContent) + '<br><span class="warn">This browser can\'t preview the original format. Cloudflare Stream will convert it for playback after upload.</span>'; } });
    const t = $("#vtitle");
    if (o.title && !t.value) t.value = o.title.slice(0, 100);
    if (!t.value) t.value = o.imported ? "" : f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100);
    t.focus();
    pickFrame();
  }
  $("#tShuffle").addEventListener("click", pickFrame);
  $("#vthumb").addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { gen++; thumb = { blob: await S.cropImage(f, 1280, 720), time: null, custom: true }; showThumb(); $("#tShuffle").disabled = !grabber; } catch(x){ toast(x.message); } });
  $("#reset").addEventListener("click", () => { if (busy) return; gen++; dropImported(); file = null; thumb = null; if (grabber) grabber.close(); grabber = null; if (prevUrl) URL.revokeObjectURL(prevUrl); prevUrl = null; $("#vprev").removeAttribute("src"); $("#vtitle").value = ""; $("#vactions").querySelectorAll(".jumpeditrow").forEach(r => r.remove()); $("#tprev").textContent = "Choosing a frame…"; $("#tinfo").textContent = ""; $("#upform").hidden = true; $("#picker").hidden = false; paintSource(); });
  window.addEventListener("beforeunload", e => { if (busy || imported){ if (busy){ e.preventDefault(); e.returnValue = ""; } } });
  window.addEventListener("pagehide", () => { if (!busy && imported && !imported.published) dropImported(); });
  $("#pub").addEventListener("click", async () => {
    if (busy) return;
    const err = $("#uperr"), btn = $("#pub"), title = $("#vtitle").value.trim(), owner_id = $("#vto").value;
    const category_ids = [...$("#vcats").querySelectorAll("input:checked")].map(i => i.value);
    if (!file){ err.textContent = "Choose a video first."; return; }
    if (!title){ err.textContent = "Add a title."; $("#vtitle").focus(); return; }
    if (!$("#cs1").checked || !$("#cs2").checked || !$("#cs3").checked){ err.textContent = "Confirm all three statements to publish."; return; }
    const dlen = grabber ? await grabber.duration() : 0;
    if (dlen > (+S.cfg.MAX_STREAM_DURATION_SECONDS || 3600)){ err.textContent = "This video is longer than the Cloudflare Stream upload limit."; return; }
    const parsedActions = readActions($("#vactions"), dlen || Infinity);
    if (parsedActions.error){ err.textContent = parsedActions.error; return; }
    const action_time = parsedActions.actions[0] ? parsedActions.actions[0].action_time : null;
    if (!S.manages(owner_id)){ err.textContent = "Pick where to post this video."; return; }
    busy = true; err.textContent = ""; btn.disabled = true; $("#reset").disabled = true; btn.innerHTML = '<span class="spin"></span>Publishing…';
    const prog = $("#prog"), bar = prog.querySelector("i"), ptxt = $("#progText");
    const fail = m => { busy = false; err.textContent = m; btn.disabled = false; $("#reset").disabled = false; btn.textContent = "Publish"; prog.hidden = true; ptxt.textContent = ""; };
    const id = S.uuid(), folder = S.user.id;
    let vpath = null, stream_uid = null;
    const duration = grabber ? await grabber.duration() : 0;
    if (imported){ vpath = imported.path; }
    else {
      prog.hidden = false; bar.style.width = "0%"; ptxt.textContent = "Uploading video… 0%";
      const t0 = Date.now();
      try { stream_uid = await S.uploadToStream(file, owner_id, duration, f => { const pc = Math.round(f * 100); bar.style.width = pc + "%"; const el2 = (Date.now() - t0) / 1000, left = f > 0.02 ? el2 / f - el2 : 0; ptxt.textContent = "Uploading video… " + pc + "%" + (left > 5 ? ", about " + (left > 90 ? Math.round(left / 60) + " min" : Math.round(left) + " s") + " left" : ""); }); }
      catch(e){ fail(errText(e, "The video didn't upload. Try again.")); return; }
    }
    ptxt.textContent = "Finishing up…";
    let tpath = null, thumbFail = false;
    if (thumb){
      const p = folder + "/thumb-" + id + ".jpg";
      let r = await sb.storage.from("images").upload(p, thumb.blob, { contentType: "image/jpeg" });
      if (r.error) r = await sb.storage.from("images").upload(p, thumb.blob, { contentType: "image/jpeg", upsert: true });
      if (!r.error) tpath = p; else { thumbFail = true; console.warn("Thumbnail upload failed:", r.error); }
    }
    const r = await sb.from("videos").insert({ owner_id, title, description: "", category_id: category_ids[0] || null, action_time, consent_attested_at: new Date().toISOString(), video_path: vpath, stream_uid, thumb_path: tpath, thumb_time: thumb && !thumb.custom ? Math.round(thumb.time * 100) / 100 : null, duration: Math.round(duration || 0) }).select("id").single();
    if (r.error){
      let cleanupError = null;
      if (stream_uid) try { await S.deleteStreamVideo(stream_uid); } catch(e){ cleanupError = e; }
      if (imported) sb.storage.from("videos").remove([vpath]).then(() => {});
      if (tpath) sb.storage.from("images").remove([tpath]).then(() => {});
      fail(errText(r.error, "The video didn't publish. Try again.") + (cleanupError ? " The uploaded video could not be removed from Cloudflare; contact support." : ""));
      return;
    }
    if (imported) imported.published = true;
    const want = picker.ids();
    try {
      await syncVideoCategories(r.data.id, category_ids, []);
      await syncVideoActions(r.data.id, parsedActions.actions);
      await syncModelTags(r.data.id, want, []);
    } catch(e){
      const message = errText(e, "The video details didn't save. Try publishing again.");
      if (stream_uid) try { await S.deleteStreamVideo(stream_uid); } catch(x){ fail(message + " The uploaded video could not be removed from Cloudflare; contact support."); return; }
      const cleanup = await sb.from("videos").delete().eq("id", r.data.id);
      if (cleanup.error) fail(message + " The partially published video could not be removed automatically; contact support.");
      else {
        if (imported) await sb.storage.from("videos").remove([vpath]);
        if (tpath) await sb.storage.from("images").remove([tpath]);
        imported = null;
        fail(message);
      }
      return;
    }
    busy = false; if (grabber) grabber.close(); location.href = watchUrl(r.data.id) + (thumbFail ? "&thumbfail=1" : "");
  });
  paintSource();
};

/* ---------- model tab (apply, status, tag requests) ---------- */
function modelInfo(p){
  return '<div class="reqbox"><h3>' + esc(displayName(p)) + ' is a verified model</h3><p>Their age and identity were checked by The Stash. Videos they appear in, with their approval, are under Featured in.</p></div>';
}
async function modelTabMine(p){
  if (p.is_model){
    const pend = must(await sb.from("video_models").select("*").eq("model_id", p.id).eq("status", "pending").order("created_at", { ascending: false }).limit(100)) || [];
    const pv = await videosByIds(pend.map(r => r.video_id)), pm = await hydrate(pv);
    const appr = must(await sb.from("video_models").select("video_id").eq("model_id", p.id).eq("status", "approved").order("created_at", { ascending: false }).limit(200)) || [];
    const av = await videosByIds(appr.map(r => r.video_id)), am = await hydrate(av);
    const row = (v, maps, pending) => { const o = maps.profiles.get(v.owner_id);
      return '<div class="plrow"><a class="thumb" href="' + esc(watchUrl(v.id)) + '">' + thumbInner(v) + '</a><div style="min-width:0"><a class="vtitle" href="' + esc(watchUrl(v.id)) + '">' + esc(v.title) + '</a><span class="vsub">by ' + esc(displayName(o)) + '</span></div><div class="acts">' +
        (pending ? '<button class="btn sm primary" data-tagok="' + esc(v.id) + '">Approve</button><button class="btn sm ghost" data-tagno="' + esc(v.id) + '">Decline</button>' : '<button class="btn sm ghost" data-tagno="' + esc(v.id) + '">Remove me</button>') + '</div></div>'; };
    return '<div class="reqbox" style="margin-bottom:20px"><h3>You\'re a verified model ✓</h3><p>You can <a href="/upload/">upload videos</a>, and other models can tag you in theirs. A tag only shows once you approve it, and you can remove yourself from any video at any time.</p></div>' +
      '<h2 class="subh">Tag requests' + (pv.length ? " (" + pv.length + ")" : "") + '</h2>' + (pv.length ? '<div style="max-width:900px">' + pv.map(v => row(v, pm, true)).join("") + '</div>' : '<p class="vsmall">No one is waiting on you.</p>') +
      '<h2 class="subh">Videos you\'re in</h2>' + (av.length ? '<div style="max-width:900px">' + av.map(v => row(v, am, false)).join("") + '</div>' : '<p class="vsmall">Approved tags show up here.</p>');
  }
  const apps = must(await sb.from("model_applications").select("*").eq("profile_id", p.id).order("created_at", { ascending: false }).limit(5)) || [];
  const last = apps[0];
  if (last && last.status === "pending") return '<div class="reqbox"><h3>Application received</h3><p>You applied on ' + esc(new Date(last.created_at).toLocaleDateString()) + ' as <b>' + esc(last.stage_name) + '</b>. We check every application by hand, so this can take a few days. You\'ll see the result here.</p></div>';
  const maxDob = new Date(); maxDob.setFullYear(maxDob.getFullYear() - 18);
  return (last && last.status === "rejected" ? '<div class="notice" style="border-left:4px solid var(--love)"><b>Your last application wasn\'t approved.</b> ' + esc(last.note || "Check that your ID is clear and matches your selfie, then apply again.") + '</div>' : "") +
    '<div class="reqbox" style="max-width:720px"><h3>Apply to be a model</h3><p>Verified models can upload videos, be tagged in videos, and get a Model badge. To keep everyone on The Stash safe, we check that every model is 18 or older and is who they say they are. Your ID is stored privately and only seen by the reviewer.</p>' +
    '<div class="row2"><div class="field"><label for="maStage">Model name <span class="hint">shown publicly</span></label><input class="input" id="maStage" maxlength="50" value="' + esc(displayName(p)) + '"></div>' +
    '<div class="field"><label for="maLegal">Legal name <span class="hint">private, must match your ID</span></label><input class="input" id="maLegal" maxlength="120" autocomplete="name"></div></div>' +
    '<div class="field"><label for="maDob">Date of birth</label><input class="input" id="maDob" type="date" max="' + maxDob.toISOString().slice(0, 10) + '" style="max-width:220px"></div>' +
    '<div class="row2"><div class="field"><label for="maId">Photo of your government ID</label><input class="input" id="maId" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"></div>' +
    '<div class="field"><label for="maSelfie">Selfie holding that ID</label><input class="input" id="maSelfie" type="file" accept="image/png,image/jpeg,image/webp" capture="user"></div></div>' +
    '<label class="check"><input type="checkbox" id="maC1"><span>I am 18 or older.</span></label>' +
    '<label class="check"><input type="checkbox" id="maC2"><span>I understand I can be tagged only with my approval, and I can remove my tag from any video at any time.</span></label>' +
    '<label class="check"><input type="checkbox" id="maC3"><span>The information and documents I\'m sending are real and belong to me.</span></label>' +
    '<div class="err" id="maErr" role="alert"></div><div class="acts" style="margin-top:12px"><button class="btn primary" id="maGo">Send application</button></div></div>';
}
function wireModelTab(p, repaint){
  const root = $("#ptab"); if (!root) return;
  root.querySelectorAll("[data-tagok]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("video_models").update({ status: "approved" }).eq("video_id", b.dataset.tagok).eq("model_id", p.id); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } toast("Tag approved"); repaint(); }));
  root.querySelectorAll("[data-tagno]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("video_models").delete().eq("video_id", b.dataset.tagno).eq("model_id", p.id); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } toast("Removed"); repaint(); }));
  const go = $("#maGo"); if (!go) return;
  go.addEventListener("click", async () => {
    const err = $("#maErr"), stage = $("#maStage").value.trim(), legal = $("#maLegal").value.trim(), dob = $("#maDob").value, idf = $("#maId").files[0], sf = $("#maSelfie").files[0];
    if (!stage){ err.textContent = "Add the name you want shown publicly."; return; }
    if (legal.length < 2){ err.textContent = "Add your legal name as it appears on your ID."; return; }
    if (!dob){ err.textContent = "Add your date of birth."; return; }
    const d = new Date(dob + "T00:00:00"), limit = new Date(); limit.setFullYear(limit.getFullYear() - 18);
    if (isNaN(d) || d > limit){ err.textContent = "You need to be 18 or older to be a model on The Stash."; return; }
    if (!idf || !sf){ err.textContent = "Add both a photo of your ID and a selfie holding it."; return; }
    if (idf.size > 10 * 1048576 || sf.size > 10 * 1048576){ err.textContent = "Each file needs to be under 10 MB."; return; }
    if (!$("#maC1").checked || !$("#maC2").checked || !$("#maC3").checked){ err.textContent = "Tick all three boxes to apply."; return; }
    err.textContent = ""; go.disabled = true; go.innerHTML = '<span class="spin"></span>Sending…';
    const up = async (f, kind) => { const ext = (f.type.split("/")[1] || "jpg").replace("jpeg", "jpg"), path = S.user.id + "/" + kind + "-" + Date.now() + "." + ext; must(await sb.storage.from("verification").upload(path, f, { contentType: f.type })); return path; };
    try {
      const id_path = await up(idf, "id"), selfie_path = await up(sf, "selfie");
      must(await sb.from("model_applications").insert({ profile_id: p.id, user_id: S.user.id, stage_name: stage.slice(0, 50), legal_name: legal.slice(0, 120), date_of_birth: dob, id_path, selfie_path }));
      toast("Application sent"); repaint();
    } catch(e){ err.textContent = e && e.code === "23505" ? "You already have an application waiting for review." : errText(e, "Your application didn't send. Try again."); go.disabled = false; go.textContent = "Send application"; }
  });
}

/* ----- profile (people and channels) ----- */
PAGES.profile = async () => {
  const el = app(); let u = (param("u") || "").toLowerCase();
  if (!u){ if (S.signedIn()) u = S.profile.username; else { setTitle("Profile"); el.innerHTML = empty("Your profile lives here", "Sign in to see your videos, playlists and achievements.", signInCta); return; } }
  let p = (await sb.from("profiles").select("*").eq("username", u).maybeSingle()).data;
  if (!p){ setTitle("Profile"); el.innerHTML = notFound("Profile"); return; }
  const chan = isChannel(p), canEdit = S.manages(p.id), isMe = S.signedIn() && p.id === S.profile.id;
  const tabsList = (p.is_model ? [["featured","Featured in"]] : []).concat([["videos","Videos"]], !chan && (isMe || p.is_model) ? [["model", isMe ? "Model" : "Model info"]] : [], [["playlists","Playlists"],["achievements","Achievements"]]);
  let tab = tabsList.some(t => t[0] === param("tab")) ? param("tab") : tabsList[0][0];
  const [stats, st, vidsR, listsR, manager, runs] = await Promise.all([
    profileStats(p.id), myState(),
    sb.from("video_feed").select("*").eq("owner_id", p.id).order("created_at", { ascending: false }).limit(200),
    sb.from("playlists").select("*").eq("owner_id", p.id).order("updated_at", { ascending: false }).limit(200),
    chan && !p.user_id ? managerOf(p) : null,
    !chan && p.user_id ? sb.from("profiles").select(S.PROFILE_COLS).eq("manager_id", p.user_id).eq("kind", "channel").neq("id", p.id).order("created_at") : { data: [] }
  ]);
  const vids = vidsR.data || [], lists = listsR.data || [], channels = runs.data || [];
  const maps = { profiles: new Map([[p.id, p]]) };
  let counts = { followers: stats.followers || 0, following: stats.following || 0, subscribers: stats.subscribers || 0 }, ach = null;
  S.onPeopleChange = async () => { const s = await profileStats(p.id); counts = { followers: s.followers, following: s.following, subscribers: s.subscribers }; paint(); };
  const ann = S.anniversary(p.created_at);
  const paint = async () => {
    setTitle(displayName(p));
    const w = (n, word) => '<b>' + fmtCount(n) + '</b> ' + word + (n === 1 ? "" : "s");
    const countsHtml = chan
      ? '<button data-people="subscribers">' + w(counts.subscribers, "subscriber") + '</button><span>' + w(vids.length, "video") + '</span>'
      : '<button data-people="followers">' + w(counts.followers, "follower") + '</button><button data-people="following"><b>' + fmtCount(counts.following) + '</b> following</button><span>' + w(vids.length, "video") + '</span>';
    let actions = "";
    if (canEdit) actions = '<button class="btn ghost" id="editP">' + (chan ? "Edit channel" : "Edit profile") + '</button>' + (chan ? '<a class="btn primary" href="/upload/?to=' + esc(encodeURIComponent(p.id)) + '">Upload</a>' : "");
    else actions = relationBtn(p, st);
    let h = '<div class="banner">' + S.bannerHTML(p) + '</div>' +
      '<div class="phead">' + avatar(p, 128) + '<div class="pinfo"><h1>' + esc(displayName(p)) + badges(p) + '</h1><div class="handle">@' + esc(p.username) + '</div><div class="counts">' + countsHtml + '</div>' +
      (ann.joined ? '<div class="joined"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>Joined ' + esc(ann.joined) + (ann.years >= 1 ? ", " + ann.years + (ann.years === 1 ? " year" : " years") + " on The Stash" : "") + '</div>' : "") + '</div>' +
      '<div class="acts">' + actions + '</div></div>';
    if (ann.today) h += '<div class="annivbar" role="status"><span class="cake" aria-hidden="true">🎂</span><div><b>' + (isMe ? "Happy " + S.ordinal(ann.years) + " Stash anniversary!" : "It's @" + esc(p.username) + "'s " + S.ordinal(ann.years) + " Stash anniversary") + '</b><span>' + (isMe ? "You joined on " + esc(ann.joinedFull) + ". Thanks for being here." : "Joined " + esc(ann.joinedFull) + ".") + '</span></div></div>';
    if (p.bio) h += '<p class="bio">' + esc(p.bio) + '</p>';
    const links = (Array.isArray(p.links) ? p.links : []).map(l => ({ label: l.label, url: S.safeUrl(l.url) })).filter(l => l.url);
    if (links.length) h += '<div class="links">' + links.map(l => '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(l.label || new URL(l.url).hostname) + '</a>').join("") + '</div>';
    if (manager) h += '<div class="managedby">Run by <a class="who" href="' + esc(profileUrl(manager)) + '">' + avatar(manager, 26) + '<span class="name">' + nameLine(manager) + '</span></a></div>';
    if (S.isFounder()){
      h += '<div class="adminbox" role="group" aria-label="Admin tools"><b>Admin</b>' +
        (chan ? (p.user_id ? '<button class="btn sm ghost" id="admKind">Turn back into a personal profile</button>' : '<button class="btn sm ghost" id="admMgr">Change who runs it</button>')
              : '<button class="btn sm ghost" id="admKind">Turn into a channel</button>') +
        (!chan && p.is_model ? '<button class="btn sm ghost" id="admUnmodel">Remove model status</button>' : "") +
        '<a class="btn sm ghost" href="/admin/?tab=channels">Create a channel</a></div>';
    }
    h += '<div class="tabs" role="tablist">' + tabsList.map(([k, n]) => '<button role="tab" aria-selected="' + (tab === k) + '" class="' + (tab === k ? "cur" : "") + '" data-tab="' + k + '">' + n + '</button>').join("") + '</div><div id="ptab"></div>';
    el.innerHTML = h;
    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; const url = new URL(location.href); url.searchParams.set("tab", tab); history.replaceState(null, "", url); paint(); }));
    el.querySelectorAll("[data-people]").forEach(b => b.addEventListener("click", () => openPeople(p, b.dataset.people).catch(e => toast(errText(e)))));
    const ep = $("#editP"); if (ep) ep.addEventListener("click", () => openEditProfile(p, np => { if (np.username !== p.username){ location.href = profileUrl(np); return; } p = { ...p, ...np }; paint(); }));
    el.querySelectorAll(".phead [data-rel]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; const r = await handleRel(p, st);
      if (r != null){ if (chan) counts.subscribers += r ? 1 : -1; else counts.followers += r ? 1 : -1; } paint();
    }));
    const ak = $("#admKind"); if (ak) ak.addEventListener("click", () => {
      const to = chan ? "personal" : "channel";
      confirmModal(chan ? "Turn @" + p.username + " back into a personal profile?" : "Turn @" + p.username + " into a channel?",
        chan ? "Its subscribers become followers. People will follow it again instead of subscribing." : "Its followers become subscribers. People will subscribe to it instead of following.",
        chan ? "Make personal" : "Make channel", async () => { must(await sb.rpc("stash_set_kind", { p_profile: p.id, p_kind: to })); toast(chan ? "Now a personal profile" : "Now a channel"); location.reload(); });
    });
    const am = $("#admMgr"); if (am) am.addEventListener("click", () => openModal('<h2>Change who runs @' + esc(p.username) + '</h2><div class="field"><label for="mgU">New manager\'s username</label><input class="input" id="mgU" maxlength="24" autocapitalize="off" spellcheck="false"></div><div class="err" id="mgErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="mgGo">Save</button></div>', m => {
      $("#mgGo", m).addEventListener("click", async () => { const v = $("#mgU", m).value.trim().toLowerCase().replace(/^@/, ""); if (!v){ $("#mgErr", m).textContent = "Enter a username."; return; }
        const r = await sb.rpc("stash_set_manager", { p_channel: p.id, p_manager_username: v }); if (r.error){ $("#mgErr", m).textContent = errText(r.error); return; } closeModal(); toast("Manager changed"); location.reload(); });
    }));
    const au = $("#admUnmodel"); if (au) au.addEventListener("click", () => confirmModal("Remove @" + p.username + "'s model status?", "They'll no longer be taggable, and their tags stay on existing videos until removed.", "Remove model status", async () => { must(await sb.rpc("stash_set_model", { p_profile: p.id, p_is_model: false })); location.reload(); }));

    const t = $("#ptab");
    if (tab === "videos"){
      t.innerHTML = vids.length ? grid(vids, maps) : empty("No videos yet", canEdit ? "Your uploads will appear here." : "Nothing uploaded so far.", canEdit ? '<a class="btn primary" href="/upload/' + (chan ? "?to=" + esc(encodeURIComponent(p.id)) : "") + '">Upload a video</a>' : "");
    } else if (tab === "featured"){
      t.innerHTML = '<div class="loading" style="padding:30px 0"><span class="spin"></span></div>';
      const fr = must(await sb.from("video_models").select("video_id").eq("model_id", p.id).eq("status", "approved").order("created_at", { ascending: false }).limit(200)) || [];
      const fv = await videosByIds(fr.map(r => r.video_id)), fm = await hydrate(fv);
      if (tab !== "featured" || !$("#ptab")) return;
      $("#ptab").innerHTML = fv.length ? grid(fv, fm) : empty("Not featured yet", "Videos " + displayName(p) + " is tagged in will show up here.");
    } else if (tab === "model"){
      t.innerHTML = '<div class="loading" style="padding:30px 0"><span class="spin"></span></div>';
      const html = isMe ? await modelTabMine(p) : modelInfo(p);
      if (tab !== "model" || !$("#ptab")) return;
      $("#ptab").innerHTML = html; wireModelTab(p, () => paint());
    } else if (tab === "playlists"){
      t.innerHTML = (isMe ? '<div style="margin-bottom:14px"><button class="btn primary" id="newPl">New playlist</button></div>' : "") + (lists.length ? '<div class="loading" style="padding:30px 0"><span class="spin"></span></div>' : empty("No playlists", isMe ? "Save videos into playlists from the player." : "No playlists here yet."));
      const wire = () => { const np = $("#newPl"); if (np) np.addEventListener("click", () => newPlaylist(pl => { location.href = "/playlist/?p=" + encodeURIComponent(pl.id); })); };
      wire();
      if (lists.length){ const html = await playlistCards(lists); if (tab === "playlists" && $("#ptab")){ $("#ptab").innerHTML = (isMe ? '<div style="margin-bottom:14px"><button class="btn primary" id="newPl">New playlist</button></div>' : "") + html; wire(); } }
    } else {
      t.innerHTML = '<div class="loading" style="padding:30px 0"><span class="spin"></span></div>';
      if (!ach) ach = await achievements(p, vids, lists, counts, channels.length);
      if (tab !== "achievements" || !$("#ptab")) return;
      const got = ach.filter(x => x.cur >= x.goal).length;
      $("#ptab").innerHTML = '<p class="achsum">' + got + ' of ' + ach.length + ' unlocked</p><div class="ach">' + ach.map(x => { const done = x.cur >= x.goal, pct = Math.min(100, Math.round(x.cur / x.goal * 100));
        return '<div class="achcard ' + (done ? "got" : "locked") + '"><span class="ic" aria-hidden="true">' + x.icon + '</span><div style="flex:1;min-width:0"><h3>' + esc(x.name) + '</h3><p>' + esc(x.desc) + '</p>' +
          (done ? '<span class="vsmall" style="color:var(--ok);font-weight:600">Unlocked</span>' : '<div class="bar" role="progressbar" aria-label="' + esc(x.name) + ' progress" aria-valuemin="0" aria-valuemax="' + x.goal + '" aria-valuenow="' + Math.min(x.cur, x.goal) + '"><i style="width:' + pct + '%"></i></div><span class="vsmall">' + (x.unit === "days" ? (x.goal - Math.min(x.cur, x.goal)) + " days to go" : Math.min(x.cur, x.goal) + ' / ' + x.goal) + '</span>') + '</div></div>'; }).join("") + '</div>';
    }
  };
  await paint();
  if (canEdit && param("edit") === "1") openEditProfile(p, np => { if (np.username !== p.username){ location.href = profileUrl(np); return; } p = { ...p, ...np }; paint(); });
};
async function achievements(p, vids, lists, counts, channelsRun){
  const ann = S.anniversary(p.created_at);
  const head = { count: "exact", head: true };
  const chan = isChannel(p);
  const [cm, sbs, fol, items] = await Promise.all([
    sb.from("comments").select("id", head).eq("author_id", p.id),
    sb.from("subscriptions").select("channel_id", head).eq("profile_id", p.id),
    sb.from("follows").select("followee_id", head).eq("follower_id", p.id),
    lists.length ? sb.from("playlist_items").select("playlist_id").in("playlist_id", lists.map(l => l.id)).limit(5000) : { data: [] }
  ]);
  const per = new Map(); (items.data || []).forEach(i => per.set(i.playlist_id, (per.get(i.playlist_id) || 0) + 1));
  const biggest = Math.max(0, ...per.values());
  const likes = vids.reduce((n, v) => n + (v.like_count || 0), 0);
  const audience = chan ? counts.subscribers : counts.followers, word = chan ? "subscriber" : "follower";
  const complete = (p.avatar_path ? 1 : 0) + (p.banner_path || p.banner_preset ? 1 : 0) + (p.bio ? 1 : 0);
  const list = [];
  if (p.is_founder) list.push({ icon:"👑", name:"Founding member", desc:"The account that started The Stash", cur:1, goal:1 });
  list.push(
    { icon:"🎉", name:"Welcome to the Stash", desc:"Create an account", cur:1, goal:1 },
    { icon:"📺", name:"On air", desc:chan ? "Become a channel" : "Run a channel", cur:chan ? 1 : channelsRun, goal:1 },
    { icon:"🎬", name:"First upload", desc:"Upload a video", cur:vids.length, goal:1 },
    { icon:"🗃️", name:"Stash builder", desc:"Upload 10 videos", cur:vids.length, goal:10 },
    { icon:"🤝", name:"First " + word, desc:"Get your first " + word, cur:audience, goal:1 },
    { icon:"📣", name:"Crowd pleaser", desc:"Reach 25 " + word + "s", cur:audience, goal:25 },
    { icon:"❤️", name:"Liked", desc:"Receive 10 likes on your videos", cur:likes, goal:10 },
    { icon:"🔥", name:"Fan favorite", desc:"Receive 100 likes on your videos", cur:likes, goal:100 },
    { icon:"💬", name:"Conversation starter", desc:"Post 5 comments", cur:cm.count || 0, goal:5 },
    { icon:"🧭", name:"Explorer", desc:"Follow 5 people", cur:fol.count || 0, goal:5 },
    { icon:"🔔", name:"Tuned in", desc:"Subscribe to 3 channels", cur:sbs.count || 0, goal:3 },
    { icon:"🎞️", name:"Curator", desc:"Build a playlist with 5 videos", cur:biggest, goal:5 },
    { icon:"✨", name:"Looking sharp", desc:"Add a profile picture, banner and bio", cur:complete, goal:3 },
    { icon:"🎂", name:"One year in", desc:"Celebrate your 1st Stash anniversary", cur:ann.days, goal:365, unit:"days" },
    { icon:"🥂", name:"Two years in", desc:"Celebrate your 2nd Stash anniversary", cur:ann.days, goal:730, unit:"days" },
    { icon:"🏆", name:"Five years in", desc:"Celebrate your 5th Stash anniversary", cur:ann.days, goal:1826, unit:"days" }
  );
  return list;
}

/* ----- channels (replaces subscriptions) ----- */
PAGES.channels = async () => {
  setTitle("Channels"); const el = app();
  const [all, st] = await Promise.all([ sb.from("profiles").select(S.PROFILE_COLS).eq("kind", "channel").order("created_at", { ascending: false }).limit(200), myState() ]);
  const chans = all.data || [], stats = await statsFor(chans.map(c => c.id));
  const subIds = [...st.subs].filter(id => chans.some(c => c.id === id));
  let h = '<div class="pagehead"><h1>Channels</h1>' + (S.isFounder() ? '<a class="btn primary" href="/admin/?tab=channels">Create a channel</a>' : "") + '</div>';
  if (subIds.length){
    const vids = must(await sb.from("video_feed").select("*").in("owner_id", subIds).order("created_at", { ascending: false }).limit(12)) || [];
    const maps = { profiles: new Map(chans.map(c => [c.id, c])) };
    h += '<h2 class="subh">Latest from your subscriptions</h2>' + (vids.length ? grid(vids, maps) : '<p class="vsmall">Your channels haven\'t uploaded anything yet.</p>');
  }
  h += '<h2 class="subh">' + (subIds.length ? "All channels" : "Browse channels") + '</h2>';
  if (!chans.length){ el.innerHTML = h + empty("No channels yet", "Channels will show up here once they're created.", ""); return; }
  const paint = () => '<div class="chlist">' + chans.map(c => '<div class="chrow">' + chCard(c, stats.get(c.id)) + relationBtn(c, st, "sm") + '</div>').join("") + '</div>';
  el.innerHTML = h + '<div id="chGrid">' + paint() + '</div>';
  $("#chGrid").addEventListener("click", async e => { const b = e.target.closest("[data-rel]"); if (!b) return; const c = chans.find(x => x.id === b.dataset.rel); b.disabled = true; const r = await handleRel(c, st); if (r != null){ const s2 = stats.get(c.id) || { subscribers: 0 }; s2.subscribers = Math.max(0, (s2.subscribers || 0) + (r ? 1 : -1)); stats.set(c.id, s2); } $("#chGrid").innerHTML = paint(); });
};
PAGES.subscriptions = PAGES.channels;

/* ----- categories ----- */
function openCategoryModal(cat, after){
  openModal('<h2>' + (cat ? "Rename category" : "Add a category") + '</h2><div class="field"><label for="cgN">Name</label><input class="input" id="cgN" maxlength="40" value="' + esc(cat ? cat.name : "") + '"></div><p class="vsmall" id="cgS"></p><div class="err" id="cgErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="cgGo">' + (cat ? "Save" : "Add category") + '</button></div>', m => {
    const n = $("#cgN", m), sl = $("#cgS", m);
    const paint = () => { sl.textContent = cat ? "" : "Link: /category/?c=" + (slugify(n.value) || "…"); };
    n.addEventListener("input", paint); paint();
    const go = async () => {
      const name = n.value.trim(), slug = cat ? cat.slug : slugify(name);
      if (!name || slug.length < 2){ $("#cgErr", m).textContent = "Give the category a name of at least 2 letters."; return; }
      $("#cgGo", m).disabled = true;
      const r = cat ? await sb.from("categories").update({ name }).eq("id", cat.id) : await sb.from("categories").insert({ name, slug });
      if (r.error){ $("#cgErr", m).textContent = r.error.code === "23505" ? "There's already a category with that name." : errText(r.error); $("#cgGo", m).disabled = false; return; }
      catCache = null; closeModal(); toast(cat ? "Category renamed" : "Category added"); if (after) after();
    };
    $("#cgGo", m).addEventListener("click", go); n.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  });
}
PAGES.categories = async () => {
  setTitle("Categories"); const el = app();
  const cats = await loadCategories(true);
  const counts = new Map(), first = new Map();
  if (cats.length){
    const vids = must(await sb.from("video_feed").select("id,category_id,category_ids,thumb_path,owner_id,created_at").order("created_at", { ascending: false }).limit(2000)) || [];
    vids.forEach(v => (v.category_ids || (v.category_id ? [v.category_id] : [])).forEach(id => {
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!first.has(id)) first.set(id, v);
    }));
  }
  let h = '<div class="pagehead"><h1>Categories</h1>' + (S.isFounder() ? '<button class="btn primary" id="addCat">Add category</button>' : "") + '</div>';
  h += cats.length ? '<div class="catgrid">' + cats.map(c => { const v = first.get(c.id);
    return '<a class="catcard" href="' + esc(catUrl(c)) + '"><span class="catimg" style="background:' + colorFor(c.id) + '">' + (v && v.thumb_path ? '<img src="' + esc(S.pub("images", v.thumb_path)) + '" alt="" loading="lazy">' : "") + '</span><span class="catname">' + esc(c.name) + '</span><span class="vsmall">' + plural(counts.get(c.id) || 0, "video") + '</span></a>'; }).join("") + '</div>'
    : empty("No categories yet", S.isFounder() ? "Add your first category to start sorting videos." : "Check back soon.", "");
  el.innerHTML = h;
  const a = $("#addCat"); if (a) a.addEventListener("click", () => openCategoryModal(null, () => PAGES.categories()));
};
PAGES.category = async () => {
  const el = app(), slug = (param("c") || "").toLowerCase();
  const cats = await loadCategories(), c = cats.find(x => x.slug === slug);
  if (!c){ setTitle("Category"); el.innerHTML = notFound("Category"); return; }
  setTitle(c.name);
  let offset = 0, all = [];
  const load = async () => {
    const rows = must(await sb.from("video_feed").select("*").contains("category_ids", [c.id]).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1)) || [];
    offset += rows.length; all = all.concat(rows);
    const maps = await hydrate(all);
    el.innerHTML = '<div class="pagehead"><div><a class="vsmall" href="/categories/">All categories</a><h1>' + esc(c.name) + '</h1></div><div class="acts">' + (S.signedIn() ? '<a class="btn ghost" href="/upload/?cat=' + esc(encodeURIComponent(c.slug)) + '">Upload to ' + esc(c.name) + '</a>' : "") + (S.isFounder() ? '<button class="btn ghost" id="renCat">Rename</button>' : "") + '</div></div>' +
      (all.length ? grid(all, maps) : empty("Nothing here yet", "No videos are in " + c.name + " yet.")) + (rows.length === PAGE ? '<div class="more"><button class="btn" id="more">Show more</button></div>' : "");
    const mb = $("#more"); if (mb) mb.addEventListener("click", async () => { mb.disabled = true; await load(); });
    const rn = $("#renCat"); if (rn) rn.addEventListener("click", () => openCategoryModal(c, () => location.reload()));
  };
  await load();
};

/* ----- admin (founding account) ----- */
PAGES.admin = async () => {
  setTitle("Admin"); const el = app();
  if (!S.isFounder()){ el.innerHTML = empty("This page is for the founding account", "Sign in as @daphuq_ to review models, reports, categories and channels.", '<a class="btn primary" href="/">Go home</a>'); return; }
  const TABS = [["applications","Model applications"],["reports","Reports"],["categories","Categories"],["channels","Channels"],["models","Models"]];
  let tab = TABS.some(t => t[0] === param("tab")) ? param("tab") : "applications";
  const paint = async () => {
    el.innerHTML = '<div class="pagehead"><h1>Admin</h1></div><div class="tabs" role="tablist">' + TABS.map(([k, n]) => '<button role="tab" data-tab="' + k + '" aria-selected="' + (tab === k) + '" class="' + (tab === k ? "cur" : "") + '">' + n + '</button>').join("") + '</div><div id="atab"><div class="loading" style="padding:30px 0"><span class="spin"></span></div></div>';
    el.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; const u = new URL(location.href); u.searchParams.set("tab", tab); history.replaceState(null, "", u); paint(); }));
    const t = $("#atab");
    if (tab === "applications"){
      const apps = must(await sb.from("model_applications").select("*").order("created_at", { ascending: false }).limit(100)) || [];
      const ps = await profilesByIds(apps.map(a => a.profile_id));
      const age = dob => { const d = new Date(dob + "T00:00:00"), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
      const pending = apps.filter(a => a.status === "pending"), done = apps.filter(a => a.status !== "pending").slice(0, 20);
      const card = a => { const p = ps.get(a.profile_id) || { username: "unknown" };
        return '<div class="appcard"><div class="who">' + avatar(p, 40) + '<span><a class="name" href="' + esc(profileUrl(p)) + '">@' + esc(p.username) + '</a><span class="sub">Applied ' + esc(timeAgo(a.created_at)) + '</span></span></div>' +
          '<dl><dt>Model name</dt><dd>' + esc(a.stage_name) + '</dd><dt>Legal name</dt><dd>' + esc(a.legal_name) + '</dd><dt>Date of birth</dt><dd>' + esc(a.date_of_birth) + ' (age ' + age(a.date_of_birth) + ')</dd></dl>' +
          '<div class="acts"><button class="btn sm ghost" data-doc="' + esc(a.id_path) + '">View ID</button><button class="btn sm ghost" data-doc="' + esc(a.selfie_path) + '">View selfie</button></div>' +
          (a.status === "pending" ? '<div class="acts" style="margin-top:10px"><button class="btn sm primary" data-approve="' + esc(a.id) + '">Approve</button><button class="btn sm danger" data-reject="' + esc(a.id) + '">Reject</button></div>' : '<p class="vsmall" style="margin:8px 0 0">' + (a.status === "approved" ? "Approved" : "Rejected") + (a.note ? ": " + esc(a.note) : "") + '</p>') + '</div>'; };
      t.innerHTML = '<p class="vsmall">Check that the ID is real and readable, the date of birth makes them 18 or older, and the selfie matches the ID. Approve only when all three are clear.</p>' +
        '<h2 class="subh">Waiting for review (' + pending.length + ')</h2>' + (pending.length ? '<div class="appgrid">' + pending.map(card).join("") + '</div>' : '<p class="vsmall">Nothing to review.</p>') +
        (done.length ? '<h2 class="subh">Recently reviewed</h2><div class="appgrid">' + done.map(card).join("") + '</div>' : "");
      t.querySelectorAll("[data-doc]").forEach(b => b.addEventListener("click", async () => {
        const w = window.open("", "_blank");
        const r = await sb.storage.from("verification").createSignedUrl(b.dataset.doc, 300);
        if (r.error || !r.data){ if (w) w.close(); toast(errText(r.error, "That file couldn't be opened.")); return; }
        if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
      }));
      t.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", () => confirmModal("Approve this model?", "Only approve if the ID is genuine, shows they're 18 or older, and matches the selfie.", "Approve", async () => { must(await sb.rpc("stash_review_model", { p_application: b.dataset.approve, p_approve: true, p_note: "" })); toast("Approved"); paint(); })));
      t.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", () => openModal('<h2>Reject application</h2><div class="field"><label for="rjN">Reason <span class="hint">the applicant will see this</span></label><textarea id="rjN" maxlength="300">The ID wasn\'t readable or didn\'t match the selfie. Please apply again with clear photos.</textarea></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rjGo">Reject</button></div>', m => {
        $("#rjGo", m).addEventListener("click", async () => { const r = await sb.rpc("stash_review_model", { p_application: b.dataset.reject, p_approve: false, p_note: $("#rjN", m).value.trim().slice(0, 300) }); if (r.error){ toast(errText(r.error)); return; } closeModal(); toast("Rejected"); paint(); });
      })));
    } else if (tab === "reports"){
      const showAll = param("all") === "1";
      let q = sb.from("reports").select("*").order("created_at", { ascending: false }).limit(200); if (!showAll) q = q.eq("status", "open");
      const reps = must(await q) || [];
      const ps = await profilesByIds(reps.map(r => r.reporter_id));
      const label = Object.fromEntries(REPORT_REASONS);
      const urgent = r => r.reason === "minor" || r.reason === "nonconsensual" || r.reason === "me_no_consent";
      t.innerHTML = '<p class="vsmall">Reports about minors or non-consent are shown first. Remove the video right away if a report looks credible.</p><div class="acts" style="margin:10px 0 16px"><a class="btn sm ghost" href="/admin/?tab=reports' + (showAll ? "" : "&all=1") + '">' + (showAll ? "Show open only" : "Show resolved too") + '</a></div>' +
        (reps.length ? reps.sort((a, b) => urgent(b) - urgent(a)).map(r => { const rp = ps.get(r.reporter_id);
          return '<div class="appcard' + (urgent(r) ? " urgent" : "") + '"><b>' + esc(label[r.reason] || r.reason) + '</b><span class="vsmall"> · ' + esc(timeAgo(r.created_at)) + (r.status === "resolved" ? " · resolved" : "") + '</span>' +
            '<p style="margin:6px 0">' + (r.video_id ? '<a href="' + esc(watchUrl(r.video_id)) + '">' + esc(r.video_title || "Video") + '</a>' : esc(r.video_title || "Video") + ' <span class="vsmall">(already deleted)</span>') + '</p>' +
            (r.details ? '<p class="bio" style="margin:6px 0">' + esc(r.details) + '</p>' : "") +
            '<p class="vsmall" style="margin:0">From ' + (rp ? '<a href="' + esc(profileUrl(rp)) + '">@' + esc(rp.username) + '</a>' : "a visitor") + (r.contact ? " (" + esc(r.contact) + ")" : "") + '</p>' +
            (r.status === "open" ? '<div class="acts" style="margin-top:10px">' + (r.video_id ? '<button class="btn sm danger" data-delvid="' + esc(r.video_id) + '" data-rep="' + esc(r.id) + '">Delete video</button>' : "") + '<button class="btn sm ghost" data-resolve="' + esc(r.id) + '">Mark resolved</button></div>' : "") + '</div>'; }).join("")
        : '<p class="vsmall">No ' + (showAll ? "" : "open ") + 'reports.</p>');
      t.querySelectorAll("[data-resolve]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; const r = await sb.from("reports").update({ status: "resolved" }).eq("id", b.dataset.resolve); if (r.error){ toast(errText(r.error)); b.disabled = false; return; } paint(); }));
      t.querySelectorAll("[data-delvid]").forEach(b => b.addEventListener("click", () => confirmModal("Delete this video?", "It's removed for everyone right away and the report is marked resolved.", "Delete video", async () => { must(await sb.from("videos").delete().eq("id", b.dataset.delvid)); await sb.from("reports").update({ status: "resolved" }).eq("id", b.dataset.rep); toast("Video deleted"); paint(); })));
    } else if (tab === "categories"){
      const cats = await loadCategories(true);
      t.innerHTML = '<div class="acts" style="margin-bottom:14px"><button class="btn primary" id="acAdd">Add category</button></div>' + (cats.length ? '<div class="ulist" style="max-width:640px">' + cats.map(c => '<div class="urow"><a class="who" href="' + esc(catUrl(c)) + '"><span class="name">' + esc(c.name) + '</span><span class="sub">/category/?c=' + esc(c.slug) + '</span></a><button class="btn sm ghost" data-ren="' + esc(c.id) + '">Rename</button><button class="btn sm danger" data-delc="' + esc(c.id) + '">Delete</button></div>').join("") + '</div>' : '<p class="vsmall">No categories yet.</p>');
      $("#acAdd").addEventListener("click", () => openCategoryModal(null, paint));
      t.querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", () => openCategoryModal(cats.find(c => c.id === b.dataset.ren), paint)));
      t.querySelectorAll("[data-delc]").forEach(b => b.addEventListener("click", () => { const c = cats.find(x => x.id === b.dataset.delc); confirmModal("Delete “" + c.name + "”?", "Videos in it stay on The Stash without a category.", "Delete category", async () => { must(await sb.from("categories").delete().eq("id", c.id)); catCache = null; paint(); }); }));
    } else if (tab === "channels"){
      const chans = must(await sb.from("profiles").select(S.PROFILE_COLS).eq("kind", "channel").order("created_at", { ascending: false }).limit(200)) || [];
      t.innerHTML = '<div class="reqbox" style="max-width:640px;margin-bottom:22px"><h3>Create a channel</h3><p>Only you can create channels. You run them unless you hand one to a member.</p>' +
        '<div class="row2"><div class="field"><label for="stUser">Channel username</label><input class="input" id="stUser" maxlength="24" autocapitalize="off" spellcheck="false" placeholder="e.g. stashoriginals"></div><div class="field"><label for="stName">Channel name</label><input class="input" id="stName" maxlength="50" placeholder="e.g. Stash Originals"></div></div>' +
        '<div class="field"><label for="stMgr">Run by <span class="hint">optional member username, leave empty to run it yourself</span></label><input class="input" id="stMgr" maxlength="24" autocapitalize="off" spellcheck="false"></div>' +
        '<div class="err" id="stErr" role="alert"></div><button class="btn primary" id="stGo">Create channel</button></div>' +
        '<h2 class="subh">All channels (' + chans.length + ')</h2>' + (chans.length ? '<div class="ulist" style="max-width:640px">' + chans.map(c => personRow(c)).join("") + '</div>' : '<p class="vsmall">None yet.</p>');
      $("#stGo").addEventListener("click", async () => {
        const u = $("#stUser").value.trim().toLowerCase().replace(/^@/, ""), n = $("#stName").value.trim(), mg = $("#stMgr").value.trim().toLowerCase().replace(/^@/, ""), err = $("#stErr"), b = $("#stGo");
        if (!S.USER_RE.test(u)){ err.textContent = "Channel usernames are 3 to 24 characters using letters, numbers, _ and . (not starting with a dot)."; return; }
        b.disabled = true; err.textContent = "";
        const r = await sb.rpc("stash_create_channel", { p_username: u, p_display_name: n, p_manager_username: mg });
        if (r.error){ b.disabled = false; err.textContent = r.error.code === "23505" ? "That channel username is taken." : errText(r.error); return; }
        await S.reloadProfile(); toast("Channel created"); location.href = "/profile/?u=" + encodeURIComponent(u);
      });
    } else {
      const ms = must(await sb.from("profiles").select(S.PROFILE_COLS).eq("is_model", true).order("created_at", { ascending: false }).limit(500)) || [];
      t.innerHTML = '<h2 class="subh">Verified models (' + ms.length + ')</h2>' + (ms.length ? '<div class="ulist" style="max-width:640px">' + ms.map(p => '<div class="urow"><a class="who" href="' + esc(profileUrl(p)) + '">' + avatar(p, 36) + '<span><span class="name">' + esc(displayName(p)) + '</span><span class="sub">@' + esc(p.username) + '</span></span></a><button class="btn sm ghost" data-unm="' + esc(p.id) + '">Remove model status</button></div>').join("") + '</div>' : '<p class="vsmall">No verified models yet. Approve applications to add them.</p>');
      t.querySelectorAll("[data-unm]").forEach(b => b.addEventListener("click", () => confirmModal("Remove model status?", "They won't be taggable any more.", "Remove", async () => { must(await sb.rpc("stash_set_model", { p_profile: b.dataset.unm, p_is_model: false })); paint(); })));
    }
  };
  await paint();
};

/* ----- 18 U.S.C. 2257 statement ----- */
PAGES.records = async () => {
  setTitle("2257 statement"); const el = app();
  const c = S.cfg.RECORDS_CUSTODIAN, a = S.cfg.RECORDS_ADDRESS;
  el.innerHTML = '<div class="legal"><h1>18 U.S.C. 2257 Record-Keeping Requirements Compliance Statement</h1>' +
    '<p>All persons who appear in any visual depiction of actual or simulated sexually explicit conduct on The Stash were 18 years of age or older at the time the depictions were created.</p>' +
    '<p>Every performer on The Stash is identity- and age-verified before they can upload or be tagged, and every upload requires the uploader to confirm that all performers were adults and consented to recording and publication.</p>' +
    '<p>The records required by 18 U.S.C. § 2257 and 28 C.F.R. Part 75 for content produced by The Stash are kept by the Custodian of Records:</p>' +
    (c && a ? '<address>' + esc(c) + '<br>' + esc(a) + '</address>' : '<div class="notice">The custodian of records hasn\'t been added yet. Site owner: fill in <code>RECORDS_CUSTODIAN</code> and <code>RECORDS_ADDRESS</code> in <code>assets/config.js</code>.</div>') +
    '<p>For content uploaded by independent creators, the uploader is the producer and keeps the records for their own content.</p>' +
    '<p>To report content that may involve a minor or someone who did not consent, use Report under the video or email <a href="mailto:' + esc(S.cfg.SUPPORT_EMAIL || "support@thestash.gay") + '">' + esc(S.cfg.SUPPORT_EMAIL || "support@thestash.gay") + '</a>. We remove it while we investigate.</p></div>';
};

/* ----- full-page login ----- */
PAGES.login = async () => {
  const card = $("#loginCard"), next = S.safeNext(param("next"));
  const hash = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
  const oauthErr = hash.get("error_description") || q.get("error_description");
  if (param("reset") === "1"){
    const ui = S.mountAuth(card, { mode: "reset", full: true, next });
    if (!S.user){ S.onAuthChange = ev => { if (ev === "PASSWORD_RECOVERY" || S.user) ui.setStep("reset"); };
      setTimeout(() => { if (!S.user){ card.innerHTML = '<div class="auth"><a class="wordmark" href="/">the stash</a><h2>This reset link has expired</h2><p class="lede">Reset links work once and expire after a while. Request a new one.</p></div>'; const b = document.createElement("button"); b.className = "btn primary submit"; b.textContent = "Send a new link"; b.onclick = () => S.mountAuth(card, { mode: "forgot", full: true, next }); card.querySelector(".auth").appendChild(b); } }, 2500); }
    return;
  }
  if (S.user && S.profile){ location.replace(next); return; }
  const mode = S.user ? "username" : (param("mode") === "signup" ? "signup" : "signin");
  S.mountAuth(card, { mode, full: true, next });
  if (oauthErr){ const e = card.querySelector("#aErr"); if (e) e.textContent = oauthErr.replace(/\+/g, " "); }
  S.onAuthChange = ev => { if (ev === "SIGNED_IN" && S.user){ S.reloadProfile().then(() => { if (S.profile) location.replace(next); else S.mountAuth(card, { mode: "username", full: true, next }); }); } };
};

/* ---------- go ---------- */
const page = document.body.dataset.page;
S.start(PAGES[page] || PAGES.home);
})();
