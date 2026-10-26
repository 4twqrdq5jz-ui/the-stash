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
  if (!S.signedIn()) return { likes: new Set(), subs: new Set(), follows: new Set() };
  const me = S.profile.id;
  const [l, s, f] = await Promise.all([
    sb.from("likes").select("video_id").eq("profile_id", me).limit(5000),
    sb.from("subscriptions").select("channel_id").eq("profile_id", me).limit(5000),
    sb.from("follows").select("followee_id").eq("follower_id", me).limit(5000)
  ]);
  return { likes: new Set((l.data || []).map(r => r.video_id)), subs: new Set((s.data || []).map(r => r.channel_id)), follows: new Set((f.data || []).map(r => r.followee_id)) };
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

/* ---------- support tools (founding account) ---------- */
S.openSupportTools = function(){
  if (!S.isFounder()) return;
  openModal('<h2>Support tools</h2><p class="lede">Only the founding account sees these. To turn someone\'s profile into a channel, open their profile and use the support box there.</p>' +
    '<h3 style="font-size:16px;margin-top:16px">Create a channel profile</h3>' +
    '<div class="field"><label for="stUser">Channel username</label><input class="input" id="stUser" maxlength="24" autocapitalize="off" spellcheck="false" placeholder="e.g. mayatravels"></div>' +
    '<div class="field"><label for="stName">Channel name</label><input class="input" id="stName" maxlength="50" placeholder="e.g. Maya Travels"></div>' +
    '<div class="field"><label for="stMgr">Run by <span class="hint">the username of the member who asked for it</span></label><input class="input" id="stMgr" maxlength="24" autocapitalize="off" spellcheck="false" placeholder="e.g. maya.films"></div>' +
    '<div class="err" id="stErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Close</button><button class="btn primary" id="stGo">Create channel</button></div>', m => {
    $("#stGo", m).addEventListener("click", async () => {
      const u = $("#stUser", m).value.trim().toLowerCase().replace(/^@/, ""), n = $("#stName", m).value.trim(), mg = $("#stMgr", m).value.trim().toLowerCase().replace(/^@/, ""), err = $("#stErr", m), b = $("#stGo", m);
      if (!S.USER_RE.test(u)){ err.textContent = "Channel usernames are 3 to 24 characters using letters, numbers, _ and . (not starting with a dot)."; return; }
      if (!mg){ err.textContent = "Enter the username of the member who will run it."; return; }
      b.disabled = true; err.textContent = "";
      const r = await sb.rpc("stash_create_channel", { p_username: u, p_display_name: n, p_manager_username: mg });
      if (r.error){ b.disabled = false; err.textContent = r.error.code === "23505" ? "That channel username is taken." : errText(r.error); return; }
      closeModal(); toast("Channel created"); location.href = "/profile/?u=" + encodeURIComponent(u);
    });
  });
};

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
    if (!all.length){ el.innerHTML = empty("The stash is empty", "No one has uploaded a video yet. Be the first to put something on the shelf.", '<a class="btn primary" href="/upload/">Upload a video</a>'); return; }
    el.innerHTML = annivNotice() + grid(all, maps) + (rows.length === PAGE ? '<div class="more"><button class="btn" id="more">Show more</button></div>' : "");
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

PAGES.subscriptions = async () => {
  setTitle("Subscriptions"); const el = app();
  if (!S.signedIn()){ el.innerHTML = empty("Your subscriptions live here", "Sign in and subscribe to channels to see their newest videos in one place.", signInCta); return; }
  const ids = (must(await sb.from("subscriptions").select("channel_id").eq("profile_id", S.profile.id).limit(500)) || []).map(s => s.channel_id);
  if (!ids.length){ el.innerHTML = empty("No subscriptions yet", "Hit Subscribe on any channel to see its newest videos here.", '<a class="btn primary" href="/">Browse videos</a>'); return; }
  const [chans, stats, vids] = await Promise.all([ profilesByIds(ids), statsFor(ids), sb.from("video_feed").select("*").in("owner_id", ids).order("created_at", { ascending: false }).limit(96) ]);
  const vv = vids.data || [], maps = { profiles: chans };
  el.innerHTML = '<div class="pagehead"><h1>Subscriptions</h1></div><div class="chlist" style="margin-bottom:28px">' + ids.map(i => chans.get(i)).filter(Boolean).map(c => chCard(c, stats.get(c.id))).join("") + '</div>' +
    (vv.length ? grid(vv, maps) : '<p class="vsmall">These channels haven\'t uploaded anything yet.</p>');
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
  const [lists, likes] = await Promise.all([
    sb.from("playlists").select("*").eq("owner_id", S.profile.id).order("updated_at", { ascending: false }).limit(200),
    sb.from("likes").select("video_id").eq("profile_id", S.profile.id).order("created_at", { ascending: false }).limit(200)
  ]);
  const liked = await videosByIds((likes.data || []).map(l => l.video_id)), maps = await hydrate(liked);
  const pl = lists.data || [];
  el.innerHTML = '<div class="pagehead"><h1>Library</h1><button class="btn primary" id="newPl">New playlist</button></div><h2 style="font-size:19px;margin-bottom:14px">Playlists</h2>' +
    (pl.length ? await playlistCards(pl) : '<p class="vsmall">You haven\'t made a playlist yet. Use Save under any video, or create one here.</p>') +
    '<h2 style="font-size:19px;margin:34px 0 14px">Liked videos</h2>' + (liked.length ? grid(liked, maps) : '<p class="vsmall">Videos you like will show up here.</p>');
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
PAGES.watch = async () => {
  const el = app(), id = param("v"), listId = param("list");
  const v = id ? (await sb.from("video_feed").select("*").eq("id", id).maybeSingle()).data : null;
  if (!v){ setTitle("Video"); el.innerHTML = empty("This video isn't available", "It may have been removed by its creator.", '<a class="btn primary" href="/">Go home</a>'); return; }
  setTitle(v.title);
  const [owR, st] = await Promise.all([ sb.from("profiles").select("*").eq("id", v.owner_id).maybeSingle(), myState() ]);
  const owner = owR.data || { id: v.owner_id, username: "unknown", kind: "personal" };
  const [ownerStats, manager] = await Promise.all([ profileStats(owner.id), isChannel(owner) && !owner.user_id ? managerOf(owner) : null ]);
  const mgrStats = manager ? await profileStats(manager.id) : null;
  let likeCount = v.like_count || 0, liked = st.likes.has(v.id);
  const counts = { [owner.id]: isChannel(owner) ? ownerStats.subscribers : ownerStats.followers };
  if (manager) counts[manager.id] = mgrStats.followers;
  const mine = S.manages(owner.id);

  el.innerHTML = '<div class="watch"><div><div id="player"></div>' +
    '<h1 class="wtitle"></h1><div id="w-meta"></div><div class="desc" id="w-desc"></div>' +
    '<section class="comments" aria-labelledby="w-ccount"><h2 id="w-ccount">Comments</h2><div id="w-composer"></div><div id="w-clist"><div class="vsmall">Loading comments…</div></div></section></div><aside id="w-next" aria-label="Up next"></aside></div>';
  $(".wtitle", el).textContent = v.title;
  let nextUrl = null, nextTitle = "", inPlaylist = false, upTimer = null;
  const autoplayOn = () => S.lsGet("stash:autoplay") !== "0";
  const cancelUpNext = () => { clearInterval(upTimer); upTimer = null; const o = $("#upnext"); if (o) o.remove(); };
  const goNext = () => { if (nextUrl) location.href = nextUrl + (nextUrl.includes("?") ? "&" : "?") + "autoplay=1"; };
  const P = S.mountPlayer($("#player"), {
    src: S.pub("videos", v.video_path), poster: v.thumb_path ? S.pub("images", v.thumb_path) : "",
    onNext: () => { if (nextUrl) goNext(); else toast("There's nothing up next yet."); },
    onEnded: () => {
      if (!nextUrl) return;
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
  if (param("autoplay") === "1") P.play();

  const whoBlock = (p, big) => {
    const n = counts[p.id] || 0, label = isChannel(p) ? plural(n, "subscriber") : plural(n, "follower");
    return '<div class="who"><a href="' + esc(profileUrl(p)) + '" aria-label="Open ' + esc(displayName(p)) + '">' + avatar(p, big ? 42 : 36) + '</a><span style="min-width:0"><a class="name" href="' + esc(profileUrl(p)) + '">' + nameLine(p) + '</a><span class="sub">@' + esc(p.username) + ', ' + label + '</span></span>' +
      (relationBtn(p, st, big ? "" : "sm") ? '<span style="margin-left:6px">' + relationBtn(p, st, big ? "" : "sm") + '</span>' : "") + '</div>';
  };
  const meta = () => {
    $("#w-meta").innerHTML = '<div class="wrow"><div class="who-row">' + whoBlock(owner, true) + (manager ? whoBlock(manager, false) : "") + '</div>' +
      '<div class="acts"><button class="btn ' + (liked ? "liked" : "") + '" id="likeBtn" aria-pressed="' + liked + '" aria-label="' + (liked ? "Unlike" : "Like") + '"><svg width="17" height="17" viewBox="0 0 24 24" fill="' + (liked ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>' + fmtCount(likeCount) + '</button>' +
        '<button class="btn" id="saveBtn"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 11h12M4 16h7M18 13v8M14 17h8"/></svg>Save</button>' +
        (mine ? '<button class="btn ghost" id="editBtn">Edit</button><button class="btn danger" id="delBtn">Delete</button>' : "") + '</div></div>';
    $("#w-desc").innerHTML = '<div class="when">' + esc(timeAgo(v.created_at)) + (likeCount ? ", " + plural(likeCount, "like") : "") + '</div>' + (v.description ? esc(v.description) : '<span class="vsmall">No description.</span>');
    $("#w-meta").querySelectorAll("[data-rel]").forEach(b => b.addEventListener("click", async () => {
      const p = b.dataset.rel === owner.id ? owner : manager; b.disabled = true;
      const r = await handleRel(p, st); if (r != null) counts[p.id] = Math.max(0, (counts[p.id] || 0) + (r ? 1 : -1)); meta();
    }));
    $("#likeBtn").addEventListener("click", async e => {
      if (!S.requireAccount()) return; const b = e.currentTarget; b.disabled = true;
      const on = !liked, me = S.profile.id;
      const res = on ? await sb.from("likes").insert({ profile_id: me, video_id: v.id }) : await sb.from("likes").delete().eq("profile_id", me).eq("video_id", v.id);
      if (res.error && res.error.code !== "23505") toast(errText(res.error, "That didn't save. Try again.")); else { liked = on; likeCount = Math.max(0, likeCount + (on ? 1 : -1)); }
      meta();
    });
    $("#saveBtn").addEventListener("click", () => openSave(v.id));
    if (mine){
      $("#editBtn").addEventListener("click", () => {
        openModal('<h2>Edit video</h2><div class="field"><label for="evTitle">Title</label><input class="input" id="evTitle" maxlength="100" value="' + esc(v.title) + '"></div><div class="field"><label for="evDesc">Description</label><textarea id="evDesc" maxlength="5000">' + esc(v.description) + '</textarea></div>' +
          '<div class="err" id="evErr" role="alert"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="evSave">Save changes</button></div>', m => {
          $("#evSave", m).addEventListener("click", async () => {
            const title = $("#evTitle", m).value.trim(), description = $("#evDesc", m).value.trim();
            if (!title){ $("#evErr", m).textContent = "Add a title."; return; }
            $("#evSave", m).disabled = true;
            const r = await sb.from("videos").update({ title, description }).eq("id", v.id);
            if (r.error){ $("#evErr", m).textContent = errText(r.error); $("#evSave", m).disabled = false; return; }
            closeModal(); toast("Video saved"); v.title = title; v.description = description; $(".wtitle", el).textContent = title; setTitle(title); meta();
          });
        });
      });
      $("#delBtn").addEventListener("click", () => confirmModal("Delete this video?", "“" + v.title + "” will be removed from The Stash for everyone, along with its comments and likes. This can't be undone.", "Delete video", async () => {
        must(await sb.from("videos").delete().eq("id", v.id));
        sb.storage.from("videos").remove([v.video_path]).then(() => {}); if (v.thumb_path) sb.storage.from("images").remove([v.thumb_path]).then(() => {});
        location.href = profileUrl(owner);
      }));
    }
  };
  meta();

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
    list.innerHTML = comments.map(c => { const p = authors.get(c.author_id) || { id: c.author_id, username: "unknown" }; const canDel = S.signedIn() && (c.author_id === S.profile.id || mine);
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

  // playlist panel and recommended videos
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
      sc += Math.log2(1 + (x.like_count || 0)) * 0.9;
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
  if (!S.signedIn()){ el.innerHTML = empty("Sign in to upload", "Anyone can watch, but you need an account to share videos.", signInCta); return; }
  const MAXMB = +S.cfg.MAX_VIDEO_MB || 50;
  const targets = S.postAs();
  const want = param("to");
  let source = param("from") === "x" ? "x" : "device";
  el.innerHTML = '<div class="upwrap"><div class="pagehead"><h1>Upload a video</h1></div>' +
    '<div id="picker"><div class="srctabs" role="tablist" aria-label="Where the video comes from"><button role="tab" data-src="device">From your device</button><button role="tab" data-src="x">From X</button></div><div id="srcPane"></div></div>' +
    '<div id="upform" hidden><div class="preview"><video id="vprev" controls playsinline muted></video></div><div class="vsmall" id="vinfo" style="margin-top:6px"></div>' +
    '<div class="field"><label for="vtitle">Title <span class="hint">(required)</span></label><input class="input" id="vtitle" maxlength="100"></div>' +
    '<div class="field"><label for="vdesc">Description</label><textarea id="vdesc" maxlength="5000"></textarea></div>' +
    '<div class="field"><label for="vto">Post to</label><select id="vto">' + targets.map(t => '<option value="' + esc(t.id) + '">' + esc(displayName(t)) + ' (@' + esc(t.username) + ')' + (isChannel(t) ? ", channel" : ", your profile") + '</option>').join("") + '</select>' +
      (targets.some(isChannel) ? "" : '<p class="vsmall" style="margin:6px 0 0">Videos post to your profile, where people can follow you. Want a channel people can subscribe to? <a href="' + esc(S.channelRequestUrl("new")) + '">Email support</a>.</p>') + '</div>' +
    '<div class="field"><label>Thumbnail <span class="hint">picked from a random moment in your video</span></label><div class="thumbpick"><div class="tp" id="tprev">Choosing a frame…</div><div><div class="vsmall" id="tinfo"></div><div class="tbtns"><button class="btn sm ghost" id="tShuffle" disabled>Pick another moment</button><label class="btn sm ghost" style="cursor:pointer">Upload an image<input type="file" id="vthumb" accept="image/png,image/jpeg,image/webp" class="sr"></label></div></div></div></div>' +
    '<div class="progress" id="prog" hidden><i></i></div><div class="vsmall" id="progText"></div><div class="err" id="uperr" role="alert"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn ghost" id="reset">Choose another video</button><button class="btn primary" id="pub">Publish</button></div></div></div>';
  if (want && targets.some(t => t.id === want)) $("#vto").value = want;
  let file = null, prevUrl = null, busy = false, grabber = null, thumb = null, thumbUrl = null, gen = 0, imported = null;

  const paintSource = () => {
    el.querySelectorAll("[data-src]").forEach(b => { const on = b.dataset.src === source; b.classList.toggle("cur", on); b.setAttribute("aria-selected", String(on)); });
    const pane = $("#srcPane");
    if (source === "device"){
      pane.innerHTML = '<div class="drop" id="drop"><h2 style="font-size:19px">Drop a video here</h2><p>MP4 or WebM, up to ' + MAXMB + ' MB.</p><label class="btn primary" style="cursor:pointer">Choose file<input type="file" id="vfile" accept="video/mp4,video/webm" class="sr"></label></div>';
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
    pane.innerHTML = '<div class="xbox"><h2>Import a video from X</h2><p>Paste a link to one of your posts' + (xname ? ' as <b>@' + esc(xname) + '</b>' : "") + '. You can only import videos from your own posts, up to ' + MAXMB + ' MB.</p>' +
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
        pick(f, { title: r.title, description: r.description, imported: true });
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
    if (!thumb){ tp.textContent = "No frame could be read from this video. Upload an image instead."; ti.textContent = ""; return; }
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
    if (!/^video\/(mp4|webm)$/.test(f.type)){ toast("Pick an MP4 or WebM video."); return; }
    if (f.size > MAXMB * 1048576){ toast("That video is " + (f.size / 1048576).toFixed(1) + " MB. The limit is " + MAXMB + " MB."); return; }
    if (!o.imported) dropImported();
    if (prevUrl) URL.revokeObjectURL(prevUrl); if (grabber) grabber.close();
    file = f; prevUrl = URL.createObjectURL(f); thumb = null; grabber = S.frameGrabber(f);
    $("#picker").hidden = true; $("#upform").hidden = false; $("#uperr").textContent = "";
    $("#vprev").src = prevUrl;
    $("#vinfo").textContent = (o.imported ? "Imported from your X post, " : f.name + ", ") + (f.size / 1048576).toFixed(1) + " MB";
    const t = $("#vtitle"), d = $("#vdesc");
    if (o.title && !t.value) t.value = o.title.slice(0, 100);
    if (o.description && !d.value && o.description !== o.title) d.value = o.description.slice(0, 5000);
    if (!t.value) t.value = o.imported ? "" : f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100);
    t.focus();
    pickFrame();
  }
  $("#tShuffle").addEventListener("click", pickFrame);
  $("#vthumb").addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { gen++; thumb = { blob: await S.cropImage(f, 1280, 720), time: null, custom: true }; showThumb(); $("#tShuffle").disabled = !grabber; } catch(x){ toast(x.message); } });
  $("#reset").addEventListener("click", () => { if (busy) return; gen++; dropImported(); file = null; thumb = null; if (grabber) grabber.close(); grabber = null; if (prevUrl) URL.revokeObjectURL(prevUrl); prevUrl = null; $("#vprev").removeAttribute("src"); $("#vtitle").value = ""; $("#vdesc").value = ""; $("#tprev").textContent = "Choosing a frame…"; $("#tinfo").textContent = ""; $("#upform").hidden = true; $("#picker").hidden = false; paintSource(); });
  window.addEventListener("beforeunload", e => { if (busy || imported){ if (busy){ e.preventDefault(); e.returnValue = ""; } } });
  window.addEventListener("pagehide", () => { if (!busy && imported && !imported.published) dropImported(); });
  $("#pub").addEventListener("click", async () => {
    if (busy) return;
    const err = $("#uperr"), btn = $("#pub"), title = $("#vtitle").value.trim(), description = $("#vdesc").value.trim(), owner_id = $("#vto").value;
    if (!file){ err.textContent = "Choose a video first."; return; }
    if (!title){ err.textContent = "Add a title."; $("#vtitle").focus(); return; }
    if (!S.manages(owner_id)){ err.textContent = "Pick where to post this video."; return; }
    busy = true; err.textContent = ""; btn.disabled = true; $("#reset").disabled = true; btn.innerHTML = '<span class="spin"></span>Publishing…';
    const prog = $("#prog"), bar = prog.querySelector("i"), ptxt = $("#progText");
    const fail = m => { busy = false; err.textContent = m; btn.disabled = false; $("#reset").disabled = false; btn.textContent = "Publish"; prog.hidden = true; ptxt.textContent = ""; };
    const id = S.uuid(), folder = S.user.id;
    let vpath;
    const duration = grabber ? await grabber.duration() : 0;
    if (imported){ vpath = imported.path; }
    else {
      vpath = folder + "/" + id + "." + (file.type === "video/webm" ? "webm" : "mp4");
      prog.hidden = false; bar.style.width = "0%"; ptxt.textContent = "Uploading video… 0%";
      try { await S.uploadWithProgress("videos", vpath, file, f => { const pc = Math.round(f * 100); bar.style.width = pc + "%"; ptxt.textContent = "Uploading video… " + pc + "%"; }); }
      catch(e){ fail(errText(e, "The video didn't upload. Try again.")); return; }
    }
    ptxt.textContent = "Finishing up…";
    let tpath = null;
    if (thumb){ const p = folder + "/thumb-" + id + ".jpg"; const r = await sb.storage.from("images").upload(p, thumb.blob, { contentType: "image/jpeg" }); if (!r.error) tpath = p; }
    const r = await sb.from("videos").insert({ owner_id, title, description, video_path: vpath, thumb_path: tpath, thumb_time: thumb && !thumb.custom ? Math.round(thumb.time * 100) / 100 : null, duration: Math.round(duration || 0) }).select("id").single();
    if (r.error){ if (!imported) sb.storage.from("videos").remove([vpath]).then(() => {}); if (tpath) sb.storage.from("images").remove([tpath]).then(() => {}); fail(errText(r.error, "The video didn't publish. Try again.")); return; }
    if (imported) imported.published = true;
    busy = false; if (grabber) grabber.close(); location.href = watchUrl(r.data.id);
  });
  paintSource();
};

/* ----- profile (people and channels) ----- */
PAGES.profile = async () => {
  const el = app(); let u = (param("u") || "").toLowerCase();
  if (!u){ if (S.signedIn()) u = S.profile.username; else { setTitle("Profile"); el.innerHTML = empty("Your profile lives here", "Sign in to see your videos, playlists and achievements.", signInCta); return; } }
  let p = (await sb.from("profiles").select("*").eq("username", u).maybeSingle()).data;
  if (!p){ setTitle("Profile"); el.innerHTML = notFound("Profile"); return; }
  const chan = isChannel(p), canEdit = S.manages(p.id), isMe = S.signedIn() && p.id === S.profile.id;
  const tabsList = [["videos","Videos"]].concat(chan ? [] : [["channels","Channels"]], [["playlists","Playlists"],["achievements","Achievements"]]);
  let tab = tabsList.some(t => t[0] === param("tab")) ? param("tab") : "videos";
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
      h += '<div class="adminbox" role="group" aria-label="Support tools"><b>Support</b>' +
        (chan ? (p.user_id ? '<button class="btn sm ghost" id="admKind">Turn back into a personal profile</button>' : '<button class="btn sm ghost" id="admMgr">Change who runs it</button>')
              : '<button class="btn sm ghost" id="admKind">Turn into a channel</button>') +
        '<button class="btn sm ghost" id="admNew">Create a channel profile</button></div>';
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
    const an = $("#admNew"); if (an) an.addEventListener("click", () => S.openSupportTools());

    const t = $("#ptab");
    if (tab === "videos"){
      t.innerHTML = vids.length ? grid(vids, maps) : empty("No videos yet", canEdit ? "Your uploads will appear here." : "Nothing uploaded so far.", canEdit ? '<a class="btn primary" href="/upload/' + (chan ? "?to=" + esc(encodeURIComponent(p.id)) : "") + '">Upload a video</a>' : "");
    } else if (tab === "channels"){
      let ch = "";
      if (channels.length){ const stc = await statsFor(channels.map(c => c.id)); ch = '<div class="chlist" style="margin-bottom:20px">' + channels.map(c => chCard(c, stc.get(c.id))).join("") + '</div>'; }
      if (tab !== "channels" || !$("#ptab")) return;
      if (isMe) ch += '<div class="reqbox"><h3>Want a channel?</h3><p>Channels are profiles people subscribe to. To get one, email support. You can ask for a new channel profile, or for this profile to become a channel.</p><div class="acts"><a class="btn primary" href="' + esc(S.channelRequestUrl("new")) + '">Request a new channel</a><a class="btn ghost" href="' + esc(S.channelRequestUrl("convert")) + '">Turn my profile into a channel</a></div><p class="vsmall" style="margin:10px 0 0">Emails go to ' + esc(S.cfg.SUPPORT_EMAIL || "support@thestash.gay") + '.</p></div>';
      else if (!channels.length) ch = empty("No channels", "@" + p.username + " doesn't run any channels yet.");
      $("#ptab").innerHTML = ch;
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
