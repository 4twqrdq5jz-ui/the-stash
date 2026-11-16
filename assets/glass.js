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
     Layers inside the bar, bottom to top: resting pill, the real tabs (one evenodd clip punches the lens out of them),
     a blue copy of the tabs magnified and clipped to the lens, then the lens rim/gloss.
     Per frame only transforms, two clip-paths and the lens size change — no layout of the tabs, no per-tab work. */
  function initTabbar(nav){
    let lens, rim, base, tint, tabs = [], cur = -1, L = null, building = false;
    // springs: x = lens centre (px), p = 0 resting pill .. 1 popped lens
    const s = { x:0, vx:0, tx:0, p:0, vp:0, tp:0 };
    let raf = 0, last = 0, drag = null, fromPointer = false, navTimer = 0, sinkTimer = 0;

    function build(){
      const loose = [...nav.querySelectorAll(":scope > a")];
      if (!loose.length && base && base.isConnected) { tabs = [...base.children]; return tabs.length > 0; }
      if (!loose.length) return false;
      building = true;
      lens = document.createElement("span"); lens.className = "lg-lens";
      base = document.createElement("div"); base.className = "lg-base";
      tint = document.createElement("div"); tint.className = "lg-tint";
      rim = document.createElement("span"); rim.className = "lg-rim";
      [lens, tint, rim].forEach(el => el.setAttribute("aria-hidden", "true"));
      base.append(...loose);
      nav.append(lens, base, tint, rim);
      tabs = loose;
      tint.innerHTML = tabs.map(a => '<span class="lg-ti">' + a.innerHTML + "</span>").join("");
      nav.classList.add("lg-live");
      queueMicrotask(() => { building = false; });
      return true;
    }
    function measure(){
      const bx = base.offsetLeft, by = base.offsetTop;
      L = { w:nav.clientWidth, h:nav.clientHeight, bx, by, c:tabs.map(a => bx + a.offsetLeft + a.offsetWidth / 2), tw:tabs[0].offsetWidth, th:tabs[0].offsetHeight };
      cur = tabs.findIndex(a => a.classList.contains("cur"));
    }
    const nearest = x => L.c.reduce((b, c, i) => Math.abs(c - x) < Math.abs(L.c[b] - x) ? i : b, 0);
    const clampX = x => Math.min(L.c[L.c.length - 1], Math.max(L.c[0], x));
    const f = n => Math.round(n * 100) / 100;
    function capsule(x, y, w, h){
      const r = f(Math.min(w, h) / 2); x = f(x); y = f(y); w = f(w); h = f(h);
      return `M${x + r} ${y}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${x} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${y}Z`;
    }
    function paint(){
      if (!L) return;
      const p = Math.max(0, s.p), pp = Math.min(1, p);
      // measured from the recording: popped lens ≈ 1.3 tabs wide and ~10px taller than the bar; it smears sideways with speed
      const stretch = Math.min(Math.abs(s.vx) / 1700, .55) * pp;
      const w = L.tw * (1 + .3 * p) * (1 + stretch);
      const h = L.th * (1 + .32 * p) * (1 - stretch * .3);
      const x = s.x - w / 2, y = L.h / 2 - h / 2;
      const shown = cur >= 0 || p > .01;
      const box = `translate3d(${f(x)}px,${f(y)}px,0)`;
      lens.style.cssText = `width:${f(w)}px;height:${f(h)}px;transform:${box};opacity:${shown ? f(Math.max(0, 1 - p * 1.8)) : 0}`;
      rim.style.cssText = `width:${f(w)}px;height:${f(h)}px;transform:${box};opacity:${f(Math.min(1, p * 1.6))}`;
      if (!shown){ tint.style.visibility = "hidden"; base.style.clipPath = ""; return; }
      // blue copy: magnified about the lens centre; its clip is in pre-scale coordinates so it lands exactly on the lens
      const m = 1 + .12 * pp, cw = w / m, ch = h / m, cx = s.x - cw / 2, cy = L.h / 2 - ch / 2;
      tint.style.visibility = "visible";
      tint.style.transformOrigin = `${f(s.x)}px ${f(L.h / 2)}px`;
      tint.style.transform = p > .005 ? `scale(${f(m * 1000) / 1000})` : "none";
      tint.style.clipPath = `inset(${f(cy)}px ${f(L.w - cx - cw)}px ${f(L.h - cy - ch)}px ${f(cx)}px round ${f(Math.min(cw, ch) / 2)}px)`;
      // the plain tabs get one hole the shape of the lens, so only the blue copy shows inside it
      base.style.clipPath = `path(evenodd,"M-60 -60H${L.w + 60}V${L.h + 60}H-60Z${capsule(x - L.bx, y - L.by, w, h)}")`;
    }
    function step(t){
      const dt = Math.min(.034, (t - (last || t)) / 1000) || 1 / 60; last = t;
      if (still.matches){ s.x = s.tx; s.vx = 0; s.p = s.tp; s.vp = 0; }
      else {
        // finger-follow is tight (no felt lag); release/snap is softer with a small overshoot; the pop wobbles a little
        const k = drag ? 1100 : 520, c = drag ? 58 : 36;
        for (let i = 0, n = 2, h = dt / n; i < n; i++){   // two substeps keep the stiff spring stable at 60/120Hz
          s.vx += (k * (s.tx - s.x) - c * s.vx) * h; s.x += s.vx * h;
          s.vp += (460 * (s.tp - s.p) - 22 * s.vp) * h; s.p += s.vp * h;
        }
      }
      paint();
      const settled = Math.abs(s.tx - s.x) < .15 && Math.abs(s.vx) < 3 && Math.abs(s.tp - s.p) < .002 && Math.abs(s.vp) < .02;
      if (settled && !drag){ s.x = s.tx; s.p = s.tp; s.vx = s.vp = 0; paint(); raf = 0; last = 0; return; }
      raf = requestAnimationFrame(step);
    }
    const kick = () => { if (!raf){ last = 0; raf = requestAnimationFrame(step); } };
    function reset(){
      if (!on()){ if (base) base.style.clipPath = ""; return; }
      if (!build()) return;
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
      // the lens holds over the chosen tab for a beat, then sinks back into the pill
      clearTimeout(sinkTimer); sinkTimer = setTimeout(() => { s.tp = 0; kick(); }, 260);
      fromPointer = true; setTimeout(() => { fromPointer = false; }, 500);
      if (i !== cur){
        const href = tabs[i].href; cur = i;
        clearTimeout(navTimer); navTimer = setTimeout(() => { location.href = href; }, 150);
      }
    };
    nav.addEventListener("pointerdown", e => {
      if (!on() || !e.isPrimary || !L) return;
      clearTimeout(sinkTimer);
      const r = nav.getBoundingClientRect();
      drag = { id:e.pointerId, x0:e.clientX, left:r.left, moved:false };
      if (cur < 0 && s.p < .02) s.x = clampX(e.clientX - r.left);   // no current tab: the lens appears under the finger
      s.tp = 1; s.tx = clampX(e.clientX - r.left); kick();
      addEventListener("pointermove", move, { passive:true }); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    });
    // pointer taps navigate from pointerup; keyboard activation (detail 0) still uses the normal click
    nav.addEventListener("click", e => { if (on() && (fromPointer || e.detail > 0)) e.preventDefault(); }, true);
    nav.addEventListener("contextmenu", e => { if (on()) e.preventDefault(); });
    addEventListener("pageshow", e => { if (e.persisted){ clearTimeout(navTimer); clearTimeout(sinkTimer); drag = null; reset(); } });
    addEventListener("resize", () => { if (on() && L){ measure(); s.x = s.tx = L.c[nearest(s.tx)]; paint(); } });

    // renderHeader replaces the bar's contents (e.g. once sign-in resolves); re-wrap the new tabs
    new MutationObserver(() => { if (!building && nav.querySelector(":scope > a")) reset(); }).observe(nav, { childList:true });
    onToggle = reset;
    reset();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (on() && L){ measure(); paint(); } });
    // warm the cache for the other tabs so switching is quick
    const warm = () => tabs.forEach(a => { if (!a.classList.contains("cur")) fetch(a.href, { credentials:"same-origin" }).catch(() => {}); });
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout:3000 }); else setTimeout(warm, 1500);
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
