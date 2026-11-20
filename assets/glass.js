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
     In the bar: the resting pill, then the real tabs (one evenodd clip punches the lens out of them).
     In a fixed overlay exactly over the bar (outside it, so the bar's own CSS can't reach in): the refraction layer,
     a blue copy of the tabs, then the lens rim/gloss. All three are magnified about the lens centre and clipped to it.
     Safari can't distort a backdrop (backdrop-filter: url() is Chromium-only), so refraction comes from a hidden,
     inert copy of the page: while the lens is up it is shown through the lens, aligned to the page and magnified,
     so what's under the lens bends and swells like it would through a drop of glass.
     Per frame only transforms, clip-paths and the lens size change — no layout, no per-tab work. */
  function initTabbar(nav){
    let lens, rim, base, tint, ov, refract, tabs = [], cur = -1, L = null, building = false;
    // springs: x = lens centre (px), p = 0 resting pill .. 1 popped lens
    const s = { x:0, vx:0, tx:0, p:0, vp:0, tp:0 };
    let raf = 0, last = 0, drag = null, fromPointer = false, sinkTimer = 0;

    function build(){
      const loose = [...nav.querySelectorAll(":scope > a")];
      if (!loose.length && base && base.isConnected) { tabs = [...base.children]; return tabs.length > 0; }
      if (!loose.length) return false;
      building = true;
      if (!ov){
        ov = document.createElement("div"); ov.className = "lg-overlay";
        refract = document.createElement("div"); refract.className = "lg-refract";
        tint = document.createElement("div"); tint.className = "lg-tint";
        rim = document.createElement("span"); rim.className = "lg-rim";
        ov.setAttribute("aria-hidden", "true");
        ov.append(refract, tint, rim);
        document.body.append(ov);
      }
      lens = document.createElement("span"); lens.className = "lg-lens"; lens.setAttribute("aria-hidden", "true");
      base = document.createElement("div"); base.className = "lg-base";
      base.append(...loose);
      nav.append(lens, base);
      tabs = loose;
      tint.innerHTML = tabs.map(a => '<span class="lg-ti">' + a.innerHTML + "</span>").join("");
      nav.classList.add("lg-live");
      queueMicrotask(() => { building = false; });
      return true;
    }
    function measure(){
      const bx = base.offsetLeft, by = base.offsetTop, r = nav.getBoundingClientRect();
      L = { w:nav.clientWidth, h:nav.clientHeight, bx, by, left:r.left, top:r.top, c:tabs.map(a => bx + a.offsetLeft + a.offsetWidth / 2), tw:tabs[0].offsetWidth, th:tabs[0].offsetHeight };
      ov.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      cur = currentTab();
    }
    // the tab for this page: the one core.js marked, else the one whose link is this URL (e.g. "You" on your own profile)
    function currentTab(){
      const marked = tabs.findIndex(a => a.classList.contains("cur"));
      if (marked >= 0) return marked;
      const here = new URLSearchParams(location.search);
      return tabs.findIndex(a => {
        const u = new URL(a.href, location.href);
        if (u.origin !== location.origin || u.pathname !== location.pathname) return false;
        for (const [k, v] of u.searchParams) if (here.get(k) !== v) return false;
        return true;
      });
    }

    /* page copy for refraction: rebuilt on idle after the page changes, so pressing the bar never pays for it */
    const pageEl = () => document.querySelector("body > .shell") || document.querySelector("main");
    let copy = null, copyOf = null, dirty = true, copyTimer = 0, org = null;
    function makeCopy(){
      const src = pageEl(); if (!src || !refract) return;
      const c = src.cloneNode(true);
      c.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
      c.removeAttribute("id");
      c.querySelectorAll("video").forEach(v => { v.removeAttribute("src"); v.removeAttribute("autoplay"); v.preload = "none"; v.querySelectorAll("source").forEach(x => x.remove()); });
      c.querySelectorAll("iframe, script, noscript").forEach(el => el.remove());
      // images the page already has decode from cache; ones it hasn't loaded yet stay lazy so nothing extra downloads
      const imgs = src.querySelectorAll("img"), cimgs = c.querySelectorAll("img");
      cimgs.forEach((im, i) => { if (imgs[i] && imgs[i].complete) im.loading = "eager"; });
      c.setAttribute("inert", ""); c.classList.add("lg-copy");
      refract.replaceChildren(c);
      copy = c; copyOf = src; dirty = false;
    }
    function scheduleCopy(){
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        const go = () => { if (on() && !drag && s.p < .01) makeCopy(); else scheduleCopy(); };
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout:1500 }); else go();
      }, 450);
    }
    function watchPage(){
      const src = pageEl(); if (!src) return;
      new MutationObserver(() => { dirty = true; scheduleCopy(); }).observe(src, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["src", "srcset", "hidden"] });
      addEventListener("load", () => { dirty = true; scheduleCopy(); });
      scheduleCopy();
    }
    function alignCopy(){
      if (!copy) return;
      if (dirty || copyOf !== pageEl()) makeCopy();
      const r = copyOf.getBoundingClientRect();
      org = { x:r.left, y:r.top, sy:scrollY };
      copy.style.width = r.width + "px";
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
      // the resting pill only ever belongs to a current tab; with none, the lens appears clear with no grey flash
      lens.style.cssText = `width:${f(w)}px;height:${f(h)}px;transform:${box};opacity:${cur >= 0 ? f(Math.max(0, 1 - p * 1.8)) : 0}`;
      rim.style.cssText = `width:${f(w)}px;height:${f(h)}px;transform:${box};opacity:${f(Math.min(1, p * 1.6))}`;
      const m = 1 + .12 * pp;
      // refraction: the page copy, lined up with the real page, then magnified about the lens centre
      if (copy && org && p > .01){
        const mr = 1 + .2 * pp;   // content behind bends a little harder than the icons sitting in the glass
        const Px = L.left + s.x, Py = L.top + L.h / 2, Bx = L.left + x, By = L.top + y;
        const ox = org.x, oy = org.y - (scrollY - org.sy);
        refract.style.cssText = `visibility:visible;width:${f(w)}px;height:${f(h)}px;transform:${box};opacity:${f(Math.min(1, p * 2.2))}`;
        copy.style.transform = `translate3d(${f(Px * (1 - mr) + mr * ox - Bx)}px,${f(Py * (1 - mr) + mr * oy - By)}px,0) scale(${f(mr * 1000) / 1000})`;
      } else refract.style.visibility = "hidden";
      if (!shown){ tint.style.visibility = "hidden"; base.style.clipPath = ""; return; }
      // blue copy, clipped exactly to the lens. Each icon swells about its own centre (not the lens centre), so nothing
      // near the lens edge gets pushed out of view — that was what chopped letters off ("Upl ad")
      tint.style.visibility = "visible";
      tint.style.setProperty("--m", p > .005 ? f(m * 1000) / 1000 : 1);
      tint.style.clipPath = `inset(${f(y)}px ${f(L.w - x - w)}px ${f(L.h - y - h)}px ${f(x)}px round ${f(Math.min(w, h) / 2)}px)`;
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
      const moved = drag.moved;
      drag = null;
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      if (e.type === "pointercancel"){ s.tx = L.c[Math.max(cur, 0)]; s.tp = 0; kick(); return; }
      const i = nearest(s.tx); s.tx = L.c[i]; kick();
      // the lens holds over the chosen tab for a beat, then sinks back into the pill
      clearTimeout(sinkTimer); sinkTimer = setTimeout(() => { s.tp = 0; kick(); }, 260);
      fromPointer = true; setTimeout(() => { fromPointer = false; }, 500);
      if (i === cur){
        // the tab you're already on never reloads; tapping it scrolls back to the top, like iOS
        if (!moved && scrollY > 0) scrollTo({ top:0, behavior:still.matches ? "auto" : "smooth" });
        return;
      }
      // go the moment the finger lifts; the next page paints its pill on the new tab (and a snapshot, below)
      cur = i; location.href = tabs[i].href;
    };
    nav.addEventListener("pointerdown", e => {
      if (!on() || !e.isPrimary || !L) return;
      clearTimeout(sinkTimer);
      const r = nav.getBoundingClientRect();
      drag = { id:e.pointerId, x0:e.clientX, left:r.left, moved:false };
      if (cur < 0 && s.p < .02) s.x = clampX(e.clientX - r.left);   // no current tab: the lens appears under the finger
      if (s.p < .01) alignCopy();
      s.tp = 1; s.tx = clampX(e.clientX - r.left); kick();
      addEventListener("pointermove", move, { passive:true }); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    });
    // pointer taps navigate from pointerup; keyboard activation (detail 0) still uses the normal click
    nav.addEventListener("click", e => { if (on() && (fromPointer || e.detail > 0)) e.preventDefault(); }, true);
    nav.addEventListener("contextmenu", e => { if (on()) e.preventDefault(); });
    addEventListener("pageshow", e => { if (e.persisted){ clearTimeout(sinkTimer); drag = null; reset(); } });
    addEventListener("resize", () => { if (on() && L){ measure(); s.x = s.tx = L.c[nearest(s.tx)]; paint(); } });

    // renderHeader replaces the bar's contents (e.g. once sign-in resolves); re-wrap the new tabs
    new MutationObserver(() => { if (!building && nav.querySelector(":scope > a")) reset(); }).observe(nav, { childList:true });
    onToggle = reset;
    reset();
    watchPage();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (on() && L){ measure(); paint(); } });
    // warm the cache for the other tabs so switching is quick
    const warm = () => tabs.forEach(a => { if (!a.classList.contains("cur")) fetch(a.href, { credentials:"same-origin" }).catch(() => {}); });
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout:3000 }); else setTimeout(warm, 1500);
  }

  /* ---------- touch light, and a fainter hover light with a mouse ---------- */
  const LIT = ".top .iconbtn, .top .btn, .toast, .sp-big, .lg-glass";
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  function light(el, e){ const r = el.getBoundingClientRect(); el.style.setProperty("--px", (e.clientX - r.left) + "px"); el.style.setProperty("--py", (e.clientY - r.top) + "px"); }
  document.addEventListener("pointerdown", e => {
    if (!on()) return;
    const el = e.target.closest && e.target.closest(LIT); if (!el) return;
    light(el, e); el.classList.add("lg-pressed");
    const move = ev => light(el, ev);
    const up = () => { el.classList.remove("lg-pressed"); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    addEventListener("pointermove", move, { passive:true }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }, { passive:true });
  // hover: one light update per frame at most
  let hoverEl = null, hoverEv = null, hoverRaf = 0;
  document.addEventListener("pointermove", e => {
    if (!on() || !fine.matches || e.pointerType !== "mouse") return;
    const el = e.target.closest && e.target.closest(LIT);
    if (hoverEl && hoverEl !== el) hoverEl.classList.remove("lg-hover");
    hoverEl = el; hoverEv = e;
    if (el && !hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (hoverEl){ hoverEl.classList.add("lg-hover"); light(hoverEl, hoverEv); } });
  }, { passive:true });
  // iOS Safari only applies :active when a touch listener exists
  document.addEventListener("touchstart", () => {}, { passive:true });

  /* ---------- scroll-speed flare: a sheen crosses the tab bar while the page moves fast ---------- */
  let flare = 0, flareRaf = 0, flareY = scrollY, flareT = 0, flareSet = -1;
  function flareTick(t){
    flareRaf = 0;
    const nav = document.getElementById("bottomnav"); if (!nav) return;
    const dt = flareT ? Math.max(8, t - flareT) : 16, v = Math.abs(scrollY - flareY) / dt;   // px per ms
    flareY = scrollY; flareT = t;
    flare += (Math.min(1, v / 2.5) - flare) * .3;
    const out = flare < .02 ? 0 : Math.round(flare * 100) / 100;
    if (out !== flareSet){ nav.style.setProperty("--lg-flare", out); flareSet = out; }
    if (out > 0 || v > .05) flareRaf = requestAnimationFrame(flareTick); else flareT = 0;
  }
  addEventListener("scroll", () => { if (on() && !still.matches && !flareRaf) flareRaf = requestAnimationFrame(flareTick); }, { passive:true });

  /* ---------- refraction (Chromium): an SVG displacement filter used as the backdrop ----------
     The displacement map is built inside the filter for the surface's size: a flood exactly the size of the element,
     blurred, falls off towards every edge; comparing copies offset left/right and up/down gives a map that is neutral
     in the middle and points inward near the rim and corners. Displacing by it pulls the content behind the edges
     inward and bends it like the shoulder of a lens. (In a backdrop filter Chromium won't draw feImage, and the
     backdrop's own alpha runs on past the edges, so neither a map image nor SourceAlpha can shape it.) The red,
     green and blue channels are displaced by slightly different amounts for a thin chromatic fringe.
     Safari and Firefox can't use url() in backdrop-filter, so there --lg-refract stays unset (CSS has the fallback). */
  const refractOK = !ios && /(Chrome|Chromium|Edg)\/\d/.test(navigator.userAgent) &&
    !!(window.CSS && CSS.supports && CSS.supports("backdrop-filter", "url(#lg) blur(1px)"));
  root.classList.toggle("lg-svg", refractOK);
  const NS = "http://www.w3.org/2000/svg";
  const filters = new Map(), registered = new Set(), dirty = new Set();
  let defs = null, filterN = 0, ro = null, buildRaf = 0;
  function defsEl(){
    if (defs && defs.isConnected) return defs;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    defs = document.createElementNS(NS, "defs"); svg.append(defs); document.body.append(svg);
    return defs;
  }
  function filterFor(w, h, strength, bezel){
    const key = [w, h, strength, bezel].join("x");
    if (filters.has(key)) return filters.get(key);
    if (filters.size >= 64) return null;   // plenty for a page; past that, surfaces keep the plain frosted look
    const id = "lg-refract-" + (++filterN), sd = bezel / 2.5, off = Math.max(1, sd * .6), K = 2.6;
    const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const a in attrs) n.setAttribute(a, attrs[a]); return n; };
    const f = el("filter", { id, x:0, y:0, width:"100%", height:"100%", primitiveUnits:"userSpaceOnUse", "color-interpolation-filters":"sRGB" });
    // edge ramp: a flood the size of the surface (origin is the element's top-left), blurred so it falls off at each edge
    f.append(el("feFlood", { "flood-color":"#fff", "flood-opacity":1, x:0, y:0, width:w, height:h, result:"fl" }));
    f.append(el("feGaussianBlur", { in:"fl", stdDeviation:sd, edgeMode:"none", result:"a" }));
    // its slope across x and y, carried in alpha: 0.5 (no shift) in the middle, pointing inward at the rim.
    // (Alpha, because colour channels get divided by alpha before the next step and would read as full strength.)
    f.append(el("feOffset", { in:"a", dx:-off, result:"xl" }), el("feOffset", { in:"a", dx:off, result:"xr" }));
    f.append(el("feComposite", { in:"xl", in2:"xr", operator:"arithmetic", k1:0, k2:K, k3:-K, k4:.5, result:"gx" }));
    f.append(el("feOffset", { in:"a", dy:-off, result:"yt" }), el("feOffset", { in:"a", dy:off, result:"yb" }));
    f.append(el("feComposite", { in:"yt", in2:"yb", operator:"arithmetic", k1:0, k2:K, k3:-K, k4:.5, result:"gy" }));
    // move each slope out of alpha into the red / green channel of an opaque map
    f.append(el("feColorMatrix", { in:"gx", type:"matrix", values:"0 0 0 1 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1", result:"rx" }));
    f.append(el("feColorMatrix", { in:"gy", type:"matrix", values:"0 0 0 0 0  0 0 0 1 0  0 0 0 0 0  0 0 0 0 1", result:"ry" }));
    f.append(el("feComposite", { in:"rx", in2:"ry", operator:"arithmetic", k1:0, k2:1, k3:1, k4:0, result:"map" }));
    const channel = ["1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"];
    [1, .94, .88].forEach((m, i) => {
      f.append(el("feDisplacementMap", { in:"SourceGraphic", in2:"map", scale:strength * 2 * m, xChannelSelector:"R", yChannelSelector:"G", result:"d" + i }));
      f.append(el("feColorMatrix", { in:"d" + i, type:"matrix", values:channel[i], result:"c" + i }));
    });
    f.append(el("feBlend", { in:"c0", in2:"c1", mode:"screen", result:"c01" }));
    f.append(el("feBlend", { in:"c01", in2:"c2", mode:"screen" }));
    defsEl().append(f);
    filters.set(key, id);
    return id;
  }
  function buildRefraction(el){
    if (!el.isConnected){ registered.delete(el); if (ro) ro.unobserve(el); return; }
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return;   // hidden for now; the ResizeObserver brings it back when it shows
    const short = Math.min(w, h), set = parseFloat(getComputedStyle(el).getPropertyValue("--lg-refraction"));
    const even = n => Math.max(0, Math.round(n / 2) * 2);
    const strength = even(isNaN(set) ? Math.min(18, short * .3) : set);
    const bezel = even(Math.min(22, Math.max(8, short * .35)));
    const id = strength > 0 && filterFor(w, h, strength, bezel);
    if (id) el.style.setProperty("--lg-refract", "url(#" + id + ")"); else el.style.removeProperty("--lg-refract");
  }
  function refract(el){
    if (!refractOK || registered.has(el)) return;
    registered.add(el);
    if (!ro) ro = new ResizeObserver(entries => entries.forEach(e => queueBuild(e.target)));
    ro.observe(el); queueBuild(el);
  }
  function queueBuild(el){
    dirty.add(el);
    if (!buildRaf) buildRaf = requestAnimationFrame(() => { buildRaf = 0; dirty.forEach(buildRefraction); dirty.clear(); });
  }

  /* ---------- the reusable primitive ----------
     LiquidGlass.attach(el, { refraction, blur, tint, radius, specular, press }) turns any element into a glass surface;
     the same works declaratively with data-glass (data-glass-refraction="20" data-glass-blur="12" …). The site's own
     floating layers (tab bar, header controls, search, menus, sheets, toasts, drawer, player menu) are picked up
     automatically and get refraction where supported. */
  const FLOATING = ".bottomnav, .top .iconbtn, .top .btn.ghost, #searchBox, .lg-search-x, .menu, .toast, .modal, .drawer, .sp-menu";
  const PROPS = { refraction:["--lg-refraction", "px"], blur:["--lg-blur", "px"], tint:["--lg-tint", ""], radius:["--lg-radius", "px"], specular:["--lg-specular", ""] };
  function attach(el, opts){
    opts = opts || {};
    el.classList.add("lg-glass");
    for (const k in PROPS){
      const v = opts[k]; if (v == null || v === "") continue;
      el.style.setProperty(PROPS[k][0], typeof v === "number" ? v + PROPS[k][1] : v);
    }
    if (opts.press) el.setAttribute("data-glass-press", "");
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    refract(el);
    return () => detach(el);
  }
  function detach(el){
    el.classList.remove("lg-glass", "lg-hover", "lg-pressed"); el.removeAttribute("data-glass-press");
    for (const k in PROPS) el.style.removeProperty(PROPS[k][0]);
    el.style.removeProperty("--lg-refract");
    registered.delete(el); if (ro) ro.unobserve(el);
  }
  function fromData(el){
    const d = el.dataset, num = v => (v != null && v !== "" && !isNaN(v) ? +v : v);
    attach(el, { refraction:num(d.glassRefraction), blur:num(d.glassBlur), tint:d.glassTint, radius:num(d.glassRadius), specular:num(d.glassSpecular), press:"glassPress" in d });
  }
  function adopt(node){
    if (node.nodeType !== 1) return;
    if (node.matches("[data-glass]")) fromData(node); else if (node.matches(FLOATING)) refract(node);
    if (node.firstElementChild){
      node.querySelectorAll("[data-glass]").forEach(fromData);
      node.querySelectorAll(FLOATING).forEach(refract);
    }
  }
  function initGlassLayers(){
    adopt(document.body);
    new MutationObserver(muts => muts.forEach(m => {
      m.addedNodes.forEach(adopt);
      m.removedNodes.forEach(n => { if (n.nodeType === 1 && registered.has(n)){ registered.delete(n); if (ro) ro.unobserve(n); } });
    })).observe(document.body, { childList:true, subtree:true });
  }
  window.LiquidGlass = { attach, detach, refraction:refractOK };

  /* ---------- search: the field grows out of the search button, a ✕ splits off, closing reverses it ----------
     Takes over core.js's dropdown toggle only while the glass is on; the form, input and submit are untouched. */
  function initSearch(){
    const top = document.getElementById("top"), box = document.getElementById("searchBox"), tog = document.getElementById("searchToggle");
    if (!top || !box || !tog) return;
    const input = box.querySelector("input");
    const x = document.createElement("button");
    x.type = "button"; x.className = "lg-search-x"; x.setAttribute("aria-label", "Close search");
    x.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    top.append(x);
    const searching = () => root.classList.contains("lg-searching");
    let from = "", closeTimer = 0;
    // the search button's circle, expressed as a clip of the full-size field
    function buttonClip(){
      const b = tog.getBoundingClientRect(), f = box.getBoundingClientRect();
      return `inset(${b.top - f.top}px ${f.right - b.right}px ${f.bottom - b.bottom}px ${b.left - f.left}px round 999px)`;
    }
    function open(){
      clearTimeout(closeTimer);
      box.classList.add("open");
      box.style.transition = "none";
      from = buttonClip(); box.style.clipPath = from;
      box.getBoundingClientRect();   // commit the start frame so the clip animates from the button
      box.style.transition = ""; box.style.clipPath = "inset(0 round 999px)";
      root.classList.add("lg-searching");
      // focus inside the tap so iOS raises the keyboard; no scroll jump for the sticky header
      input.focus({ preventScroll:true });
    }
    function close(){
      if (!searching()) return;
      input.blur();
      root.classList.remove("lg-searching");
      box.style.clipPath = from || buttonClip();
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (!searching()){ box.classList.remove("open"); box.style.clipPath = ""; } }, 430);
    }
    document.addEventListener("click", e => {
      if (!on() || !e.target.closest || !e.target.closest("#searchToggle")) return;
      e.preventDefault(); e.stopImmediatePropagation();   // replaces core.js's plain dropdown toggle
      searching() ? close() : open();
    }, true);
    x.addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && searching()) close(); });
    const prev = onToggle;
    onToggle = () => { prev(); if (!on() && searching()){ root.classList.remove("lg-searching"); box.style.clipPath = ""; } };
  }

  /* ---------- toggles: hold for the glass lens, drag to switch ---------- */
  function initToggles(){
    let t = null;
    document.addEventListener("pointerdown", e => {
      if (!on() || !e.isPrimary) return;
      const lab = e.target.closest && e.target.closest(".toggle"); if (!lab) return;
      const input = lab.querySelector("input"), sw = lab.querySelector(".sw");
      if (!input || !sw || input.disabled) return;
      t = { lab, input, sw, id:e.pointerId, x0:e.clientX, start:input.checked ? 20 : 0, moved:false };
      clearTimeout(lab._lgHold); lab.classList.add("lg-held");
    }, { passive:true });
    addEventListener("pointermove", e => {
      if (!t || e.pointerId !== t.id) return;
      const dx = e.clientX - t.x0;
      if (!t.moved && Math.abs(dx) < 4) return;
      t.moved = true; t.lab.classList.add("lg-dragging");
      const kx = Math.max(-4, Math.min(24, t.start + dx));   // a little give past each end
      t.sw.style.setProperty("--kx", kx + "px");
      t.lab.classList.toggle("lg-preview-on", kx > 10);
    }, { passive:true });
    const end = e => {
      if (!t || e.pointerId !== t.id) return;
      const { lab, input, sw, moved } = t; t = null;
      const want = lab.classList.contains("lg-preview-on");
      lab.classList.remove("lg-dragging", "lg-preview-on"); sw.style.removeProperty("--kx");
      if (moved && e.type === "pointerup"){
        // a drag decides the state itself; swallow the click the label would send so it doesn't flip it back
        lab._lgSkip = true; setTimeout(() => { lab._lgSkip = false; }, 400);
        if (input.checked !== want){ input.checked = want; input.dispatchEvent(new Event("change", { bubbles:true })); }
      }
      // the lens rides across with the knob, then shrinks back to the white pill
      lab._lgHold = setTimeout(() => lab.classList.remove("lg-held"), 230);
    };
    addEventListener("pointerup", end); addEventListener("pointercancel", end);
    document.addEventListener("click", e => {
      const lab = e.target.closest && e.target.closest(".toggle");
      if (lab && lab._lgSkip){ lab._lgSkip = false; e.preventDefault(); }
    }, true);
  }

  /* ---------- instant pages: show the last render of a page straight away, swap in the live one when it lands ----------
     On leaving a page its content is kept in sessionStorage; coming back (e.g. via the tab bar) paints that copy at
     once instead of a spinner. It's inert until the page's own render replaces it, usually a moment later. */
  const SNAP_PAGES = ["home", "channels", "subscriptions", "categories", "category", "library", "profile", "search", "playlist"];
  const snapKey = () => "stash:snap:" + location.pathname + location.search;
  function saveSnap(){
    if (!on()) return;
    const el = document.getElementById("app");
    if (!el || SNAP_PAGES.indexOf(document.body.dataset.page) < 0 || el.querySelector(":scope > .loading, :scope > .lg-snap")) return;
    const c = el.cloneNode(true);
    c.querySelectorAll("video, iframe, script, .sp").forEach(n => n.remove());
    const html = c.innerHTML;
    if (!html.trim() || html.length > 300000) return;
    try {
      const key = snapKey(), keys = JSON.parse(sessionStorage.getItem("stash:snapkeys") || "[]").filter(k => k !== key);
      keys.push(key);
      while (keys.length > 12) sessionStorage.removeItem(keys.shift());
      sessionStorage.setItem(key, html); sessionStorage.setItem("stash:snapkeys", JSON.stringify(keys));
    } catch(e){}
  }
  function restoreSnap(){
    if (!on()) return;
    const el = document.getElementById("app");
    if (!el || el.children.length !== 1 || !el.querySelector(":scope > .loading")) return;
    let html = null; try { html = sessionStorage.getItem(snapKey()); } catch(e){}
    if (html) el.innerHTML = '<div class="lg-snap" inert aria-hidden="true">' + html + "</div>";
  }
  addEventListener("pagehide", saveSnap);

  function init(){
    restoreSnap();
    initToggles();
    initGlassLayers();
    const nav = document.getElementById("bottomnav"); if (nav) initTabbar(nav);
    // the header is built by core.js after this runs; wait for its search button
    const top = document.getElementById("top");
    if (document.getElementById("searchToggle")) initSearch();
    else if (top) { const mo = new MutationObserver(() => { if (document.getElementById("searchToggle")){ mo.disconnect(); initSearch(); } }); mo.observe(top, { childList:true }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
