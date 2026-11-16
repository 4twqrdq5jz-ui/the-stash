/* Liquid Glass for the iOS mobile layout: turns on :root.lg, then drives the tab bar droplet,
   touch light, scroll-reactive reflections and tab bar minimizing. Loaded in <head> so the class lands before first paint.
   Force it on any browser with ?glass=on (or off with ?glass=off); ?glass=auto clears the override. */
(function(){
  const root = document.documentElement;
  const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch(e){} };
  const q = new URLSearchParams(location.search).get("glass");
  if (q === "on" || q === "off") lsSet("stash:glass", q); else if (q === "auto") lsSet("stash:glass", null);
  const pref = lsGet("stash:glass");
  const ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const narrow = window.matchMedia("(max-width: 860px)");
  const on = () => root.classList.contains("lg");
  function update(){
    const layout = root.dataset.layout || lsGet("stash:layout");
    const mobile = layout === "mobile" || (layout !== "desktop" && narrow.matches);
    root.classList.toggle("lg", pref !== "off" && (ios || pref === "on") && mobile);
  }
  update();
  if (narrow.addEventListener) narrow.addEventListener("change", update); else if (narrow.addListener) narrow.addListener(update);
  new MutationObserver(update).observe(root, { attributes:true, attributeFilter:["data-layout"] });

  /* ---------- tab bar droplet ---------- */
  let drag = null, suppressClick = false;
  const tabsOf = nav => [...nav.querySelectorAll("a")];
  function setIndex(nav, i){
    nav.style.setProperty("--i", i.toFixed(3));
    const near = Math.round(i);
    tabsOf(nav).forEach((a, k) => a.classList.toggle("lg-near", !!drag && k === near));
  }
  function syncPill(nav){
    const tabs = tabsOf(nav); if (!tabs.length) return;
    if (!nav.querySelector(".lg-pill")){ const p = document.createElement("span"); p.className = "lg-pill"; p.setAttribute("aria-hidden", "true"); nav.prepend(p); }
    const cur = tabs.findIndex(a => a.classList.contains("cur"));
    nav.style.setProperty("--n", tabs.length);
    nav.classList.toggle("lg-nocur", cur < 0);
    if (!drag) setIndex(nav, Math.max(cur, 0));
  }
  function initTabbar(nav){
    syncPill(nav);
    new MutationObserver(() => syncPill(nav)).observe(nav, { childList:true });
    const indexAt = x => {
      const r = nav.getBoundingClientRect(), n = tabsOf(nav).length, w = (r.width - 8) / n;
      return Math.min(n - 1, Math.max(0, (x - r.left - 4) / w - .5));
    };
    nav.addEventListener("pointerdown", e => {
      if (!on() || !e.isPrimary) return;
      drag = { x0:e.clientX, moved:false };
      nav.classList.add("lg-drag"); setIndex(nav, indexAt(e.clientX));
    });
    nav.addEventListener("pointermove", e => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x0) > 8) drag.moved = true;
      setIndex(nav, indexAt(e.clientX));
    });
    const end = e => {
      if (!drag) return;
      const moved = drag.moved, i = Math.round(indexAt(e.clientX)), tab = tabsOf(nav)[i];
      drag = null; nav.classList.remove("lg-drag");
      if (e.type === "pointercancel"){ syncPill(nav); return; }
      setIndex(nav, i); nav.classList.remove("lg-nocur");
      // a slide across tabs ends on a different element than it started, so no click fires: navigate ourselves
      if (moved && tab){
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
        if (!tab.classList.contains("cur")) location.href = tab.href; else syncPill(nav);
      }
    };
    nav.addEventListener("pointerup", end);
    nav.addEventListener("pointercancel", end);
    nav.addEventListener("click", e => { if (suppressClick){ e.preventDefault(); suppressClick = false; } }, true);
    nav.addEventListener("contextmenu", e => { if (on()) e.preventDefault(); });
  }

  /* ---------- touch light ---------- */
  const LIT = ".bottomnav, .top .iconbtn, .top .btn, .toast, .sp-big";
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

  /* ---------- scroll: reflections drift, tab bar tucks away ---------- */
  let lastY = scrollY, ticking = false, lit = [];
  function onScroll(){
    ticking = false;
    if (!on()){ root.classList.remove("lg-min"); return; }
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    const angle = (128 + Math.sin(y / 260) * 24).toFixed(1) + "deg";
    lit.forEach(el => el.style.setProperty("--lg-angle", angle));
    if (y < 0 || y > max) return; // rubber-band overscroll
    if (y < 120) { root.classList.remove("lg-min"); lastY = y; }
    else if (y > lastY + 10){ root.classList.add("lg-min"); lastY = y; }
    else if (y < lastY - 10){ root.classList.remove("lg-min"); lastY = y; }
  }
  addEventListener("scroll", () => { if (!ticking){ ticking = true; requestAnimationFrame(onScroll); } }, { passive:true });

  function init(){
    lit = [document.getElementById("bottomnav"), document.getElementById("top")].filter(Boolean);
    const nav = document.getElementById("bottomnav"); if (nav) initTabbar(nav);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
