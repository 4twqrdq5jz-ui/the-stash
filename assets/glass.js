/* Liquid Glass for the iOS home-screen web app (mobile layout): turns on :root.lg, then drives the tab bar lens and touch light.
   Loaded in <head> so the class lands before first paint.
   Force it on any browser with ?glass=on (or off with ?glass=off); ?glass=auto clears the override. */
(function(){
  const root = document.documentElement;
  const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch(e){} };
  const q = new URLSearchParams(location.search).get("glass");
  if (q === "on" || q === "off") lsSet("stash:glass", q); else if (q === "auto") lsSet("stash:glass", null);
  const pref = lsGet("stash:glass");
  const ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // only the home-screen web app, not the site in Safari's browser
  const webApp = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const narrow = window.matchMedia("(max-width: 860px)");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const on = () => root.classList.contains("lg");
  let onToggle = () => {};
  function update(){
    const layout = root.dataset.layout || lsGet("stash:layout");
    const mobile = layout === "mobile" || (layout !== "desktop" && narrow.matches);
    const was = on();
    root.classList.toggle("lg", pref !== "off" && ((ios && webApp) || pref === "on") && mobile);
    if (was !== on()) onToggle();
  }
  update();
  if (narrow.addEventListener) narrow.addEventListener("change", update); else if (narrow.addListener) narrow.addListener(update);
  new MutationObserver(update).observe(root, { attributes:true, attributeFilter:["data-layout"] });

  /* ---------- tab bar lens ----------
     At rest a tinted pill sits under the current tab. On touch it pops into a clear lens that is wider and taller
     than the bar, follows the finger on a spring, stretches with speed, and magnifies + recolors whatever icons it covers
     (a recolored copy of the tabs is clipped to the lens; the originals get a matching hole). */
  function initTabbar(nav){
    const PAD = 4;
    let lens, rim, tint, tabs = [], cur = -1, L = null;
    // spring state: x = lens centre, p = 0 resting pill .. 1 popped lens
    const s = { x:0, vx:0, tx:0, p:0, vp:0, tp:0 };
    let raf = 0, last = 0, drag = null, fromPointer = false, navTimer = 0;

    function build(){
      tabs = [...nav.querySelectorAll(":scope > a")];
      if (!tabs.length) return false;
      if (!lens || !lens.isConnected){
        lens = document.createElement("span"); lens.className = "lg-lens"; lens.setAttribute("aria-hidden", "true");
        rim = document.createElement("span"); rim.className = "lg-rim"; rim.setAttribute("aria-hidden", "true");
        tint = document.createElement("div"); tint.className = "lg-tint"; tint.setAttribute("aria-hidden", "true");
        nav.prepend(lens); nav.append(tint, rim);
      }
      nav.classList.add("lg-live");
      tint.innerHTML = tabs.map(a => '<span class="lg-ti">' + a.innerHTML + "</span>").join("");
      cur = tabs.findIndex(a => a.classList.contains("cur"));
      return true;
    }
    function measure(){
      L = { w:nav.clientWidth, h:nav.clientHeight, c:tabs.map(a => a.offsetLeft + a.offsetWidth / 2), tw:tabs[0].offsetWidth };
    }
    const nearest = x => L.c.reduce((b, c, i) => Math.abs(c - x) < Math.abs(L.c[b] - x) ? i : b, 0);
    const clampX = x => Math.min(L.c[L.c.length - 1], Math.max(L.c[0], x));
    function rrect(x, y, w, h){
      const r = Math.min(w, h) / 2;
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    }
    function paint(){
      if (!L) return;
      const p = Math.max(0, s.p), stretch = Math.min(Math.abs(s.vx) / 2600, .32);
      const w = (L.tw * (1 + .42 * p)) * (1 + stretch), h = ((L.h - PAD * 2) * (1 + .34 * p)) * (1 - stretch * .45);
      const x = s.x - w / 2, y = L.h / 2 - h / 2, m = 1 + .14 * p;
      const shown = cur >= 0 || p > .02;
      for (const el of [lens, rim]){
        el.style.width = w + "px"; el.style.height = h + "px";
        el.style.transform = `translate(${x}px,${y}px)`;
      }
      lens.style.opacity = shown ? Math.max(0, 1 - p * 1.6) : 0;
      rim.style.opacity = Math.min(1, p * 1.4);
      // recolored, magnified copy of the tabs, clipped to the lens (clip is in pre-scale coordinates)
      tint.style.visibility = shown ? "visible" : "hidden";
      tint.style.transformOrigin = `${s.x}px ${L.h / 2}px`;
      tint.style.transform = `scale(${m})`;
      const cw = w / m, ch = h / m, cx = s.x - cw / 2, cy = L.h / 2 - ch / 2;
      tint.style.clipPath = `inset(${cy}px ${L.w - cx - cw}px ${L.h - cy - ch}px ${cx}px round ${Math.min(cw, ch) / 2}px)`;
      // punch the lens out of the plain icons so only the tinted copy shows inside it
      tabs.forEach(a => {
        const ax = a.offsetLeft, aw = a.offsetWidth, ay = a.offsetTop, ah = a.offsetHeight;
        if (!shown || x > ax + aw || x + w < ax){ a.style.clipPath = ""; return; }
        a.style.clipPath = `path(evenodd,"M-40 -40H${aw + 40}V${ah + 40}H-40Z${rrect(x - ax, y - ay, w, h)}")`;
      });
    }
    function step(t){
      const dt = Math.min(.032, (t - (last || t)) / 1000) || .016; last = t;
      if (still.matches){ s.x = s.tx; s.vx = 0; s.p = s.tp; s.vp = 0; }
      else {
        // position: snappy with a little overshoot; pop: softer and bouncier so the lens wobbles as it swells/settles
        const ax = 560 * (s.tx - s.x) - 34 * s.vx; s.vx += ax * dt; s.x += s.vx * dt;
        const ap = 380 * (s.tp - s.p) - 17 * s.vp; s.vp += ap * dt; s.p += s.vp * dt;
      }
      paint();
      const settled = Math.abs(s.tx - s.x) < .2 && Math.abs(s.vx) < 4 && Math.abs(s.tp - s.p) < .002 && Math.abs(s.vp) < .02;
      if (settled && !drag){ s.x = s.tx; s.p = s.tp; s.vx = s.vp = 0; paint(); raf = 0; last = 0; return; }
      raf = requestAnimationFrame(step);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    function reset(){
      if (!on() || !build()){ tabs.forEach(a => { a.style.clipPath = ""; }); return; }
      measure();
      s.tx = s.x = L.c[Math.max(cur, 0)]; s.vx = 0;
      if (!drag){ s.tp = s.p = 0; s.vp = 0; }
      paint();
    }

    const move = e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (Math.abs(e.clientX - drag.x0) > 6) drag.moved = true;
      s.tx = clampX(e.clientX - drag.left); kick();
    };
    const end = e => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      if (e.type === "pointercancel"){ s.tx = L.c[Math.max(cur, 0)]; s.tp = 0; kick(); return; }
      const i = nearest(s.tx); s.tx = L.c[i]; kick();
      setTimeout(() => { s.tp = 0; kick(); }, 140);   // the lens lingers over the new tab, then sinks back into a pill
      fromPointer = true; setTimeout(() => { fromPointer = false; }, 500);
      if (i !== cur){
        const href = tabs[i].href; cur = i;
        clearTimeout(navTimer); navTimer = setTimeout(() => { location.href = href; }, 230);
      }
    };
    nav.addEventListener("pointerdown", e => {
      if (!on() || !e.isPrimary || !L) return;
      const r = nav.getBoundingClientRect();
      drag = { id:e.pointerId, x0:e.clientX, left:r.left, moved:false };
      if (cur < 0 && s.p < .02){ s.x = clampX(e.clientX - r.left); }   // no current tab: the lens appears under the finger
      s.tp = 1; s.tx = clampX(e.clientX - r.left); kick();
      addEventListener("pointermove", move, { passive:true }); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    });
    // pointer taps navigate from pointerup (after the lens settles); keyboard activation still uses the normal click
    nav.addEventListener("click", e => { if (on() && (fromPointer || e.detail > 0)){ e.preventDefault(); } }, true);
    nav.addEventListener("contextmenu", e => { if (on()) e.preventDefault(); });
    // back/forward cache restores the page mid-animation; put the pill back on the current tab
    addEventListener("pageshow", e => { if (e.persisted){ clearTimeout(navTimer); reset(); } });
    addEventListener("resize", () => { if (on() && tabs.length){ measure(); s.x = s.tx = L.c[nearest(s.tx)]; paint(); } });

    new MutationObserver(muts => {
      // renderHeader replaces the tabs; ignore our own lens/tint insertions
      if (muts.some(m => [...m.addedNodes].some(n => n.tagName === "A"))) reset();
    }).observe(nav, { childList:true });
    onToggle = reset;
    reset();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (on() && tabs.length){ measure(); reset(); } });
  }

  /* ---------- touch light ---------- */
  const LIT = ".top .iconbtn, .top .btn, .toast, .sp-big";
  function light(el, e){ const r = el.getBoundingClientRect(); el.style.setProperty("--px", (e.clientX - r.left) + "px"); el.style.setProperty("--py", (e.clientY - r.top) + "px"); }
  document.addEventListener("pointerdown", e => {
    if (!on()) return;
    const el = e.target.closest && e.target.closest(LIT); if (!el) return;
    light(el, e); el.classList.add("lg-pressed");
    const move = ev => light(el, ev);
    const up = () => { el.classList.remove("lg-pressed"); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    addEventListener("pointermove", move, { passive:true }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }, { passive:true });
  // iOS Safari only applies :active when a touch listener exists
  document.addEventListener("touchstart", () => {}, { passive:true });

  function init(){ const nav = document.getElementById("bottomnav"); if (nav) initTabbar(nav); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
