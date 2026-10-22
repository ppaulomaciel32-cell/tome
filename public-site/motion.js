(() => {
  "use strict";
  const query = new URLSearchParams(window.location.search);
  if (query.has("slug") || query.has("noticia")) return;
  const hero = document.querySelector(".tn-reveal");
  const stage = document.querySelector(".tn-stage");
  if (!hero && !stage) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const staticMode = !window.gsap || !window.ScrollTrigger || reduce.matches ||
    !!(navigator.connection && navigator.connection.saveData);
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  let refreshFrame = 0;
  let initialized = false;
  let timelineMounted = false;
  if (!staticMode) {
    document.documentElement.classList.add("tn-motion");
    gsap.registerPlugin(ScrollTrigger);
  }
  function updateTop() {
    if (!hero || !hero.isConnected) return;
    const value = Math.round(hero.getBoundingClientRect().top + window.scrollY) + "px";
    const style = document.documentElement.style;
    if (style.getPropertyValue("--tn-reveal-top") === value) return;
    style.setProperty("--tn-reveal-top", value);
    if (!staticMode && !refreshFrame) {
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        ScrollTrigger.refresh();
      });
    }
  }
  updateTop();
  window.addEventListener("load", updateTop);
  window.addEventListener("resize", updateTop, { passive: true });
  const main = document.querySelector("main");
  if (main && window.ResizeObserver) {
    const observer = new ResizeObserver(updateTop);
    for (let sibling = main.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      observer.observe(sibling);
    }
  }
  function initReveal() {
    if (!hero) return;
    const img = hero.querySelector(".tn-reveal__person");
    if (img) {
      const setMask = () => hero.style.setProperty("--tn-img-person", 'url("' + (img.currentSrc || img.src) + '")');
      setMask();
      img.addEventListener("load", setMask);
    }
    let target = { x: 0, y: 0 };
    let position = { x: 0, y: 0 };
    let active = false;
    let frameId = 0;
    let lastTime = 0;
    let lastPointer = null;
    function paint() {
      hero.style.setProperty("--mouse-x", position.x + "px");
      hero.style.setProperty("--mouse-y", position.y + "px");
    }
    function tick(now) {
      const elapsed = lastTime ? Math.min(now - lastTime, 64) : 16;
      lastTime = now;
      const ease = reduce.matches ? 1 : 1 - Math.exp(-elapsed / 65);
      position.x += (target.x - position.x) * ease;
      position.y += (target.y - position.y) * ease;
      paint();
      if (active && Math.hypot(target.x - position.x, target.y - position.y) > 0.1) {
        frameId = requestAnimationFrame(tick);
      } else {
        frameId = 0;
        lastTime = 0;
      }
    }
    function pointer(event) {
      if (event.pointerType === "touch") return;
      lastPointer = { x: event.clientX, y: event.clientY };
      const bounds = hero.getBoundingClientRect();
      target = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      if (!active) {
        position = { ...target };
        paint();
        active = true;
        hero.classList.add("is-active");
      } else if (!frameId) {
        frameId = requestAnimationFrame(tick);
      }
    }
    function clear() {
      active = false;
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
      hero.classList.remove("is-active");
    }
    hero.addEventListener("pointerenter", pointer);
    hero.addEventListener("pointermove", pointer);
    hero.addEventListener("pointerleave", clear);
    hero.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("resize", clear, { passive: true });
    window.addEventListener("pagehide", clear);
    window.addEventListener("scroll", () => {
      if (!active || !lastPointer) return;
      const bounds = hero.getBoundingClientRect();
      if (lastPointer.x < bounds.left || lastPointer.x > bounds.right ||
          lastPointer.y < bounds.top || lastPointer.y > bounds.bottom) {
        clear();
        return;
      }
      target = { x: lastPointer.x - bounds.left, y: lastPointer.y - bounds.top };
      if (!frameId) frameId = requestAnimationFrame(tick);
    }, { passive: true });
  }
  function initTimeline(viewport) {
    if (timelineMounted) return;
    timelineMounted = true;
    const media = gsap.matchMedia();
    media.add({ isMobile: "(max-width: 640px)", isDesktop: "(min-width: 641px)" }, context => {
      const mobile = context.conditions.isMobile;
      const promise = stage.querySelector(".tn-promise");
      const title = stage.querySelector(".tn-promise__title");
      const cards = stage.querySelectorAll(".tn-promise__card");
      const content = stage.querySelector(".tn-stage__content");
      const inner = stage.querySelector(".tn-promise__inner");
      const overflow = () => Math.max(0, inner.scrollHeight - (viewport.clientHeight - 68));
      gsap.set(promise, { autoAlpha: 0, y: 58 });
      gsap.set([title, ...cards], { autoAlpha: 0, y: 34, filter: "blur(0px)" });
      gsap.set(cards, { y: 86 });
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage, invalidateOnRefresh: true,
          scrub: mobile ? .55 : 1.15,
          start: mobile ? "top top" : "18% top",
          end: mobile ? "+=260%" : "bottom bottom"
        }
      });
      tl.to(content, { autoAlpha: 0, y: -22, duration: .55, ease: "none" }, 0)
        .to(promise, { autoAlpha: 1, y: 0, duration: .75, ease: "none" }, .62)
        .to(title, { autoAlpha: 1, y: 0, duration: .48, ease: "none" }, .82)
        .to(cards, { autoAlpha: 1, y: 0, duration: .72, stagger: .24, ease: "none" }, 1);
      if (mobile) {
        tl.to(inner, { y: () => -overflow(), duration: 1.15, ease: "none" }, 2.32);
      } else {
        tl.to(cards, { autoAlpha: 0, y: -24, filter: "blur(14px)", duration: .58, stagger: .16, ease: "none" }, 3)
          .to(title, { autoAlpha: 0, y: -18, filter: "blur(10px)", duration: .42, ease: "none" }, 3.70)
          .to(promise, { autoAlpha: 0, y: -34, duration: .5, ease: "none" }, 3.90)
          .to({}, { duration: .5, ease: "none" }, 4.40);
      }
    }, stage);
  }
  function init() {
    if (initialized) return;
    initialized = true;
    initReveal();
    const viewport = stage?.querySelector(".tn-stage__viewport");
    if (!viewport || staticMode) return;
    initTimeline(viewport);
  }
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();

