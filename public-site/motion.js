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
  const VIDEO_SRC = "https://res.cloudinary.com/dalwymbky/video/upload/vc_h264,ac_none,ki_0.1,q_auto/v1784654111/hero1_xgxoxk.mp4";
  const STATIC_POSTER = "https://res.cloudinary.com/dalwymbky/video/upload/so_35p,w_1920,f_auto,q_auto/v1784654111/hero1_xgxoxk.jpg";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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
  function initVideo(video) {
    const loader = stage.querySelector(".tn-stage__loading");
    const progress = document.getElementById("tn-stage-progress");
    let duration = 0;
    let targetTime = 0;
    let currentTime = 0;
    let rafId = 0;
    let running = false;
    let metadataReady = false;
    let visibility = null;
    const hideLoader = () => loader?.classList.add("is-hidden");
    const timeout = setTimeout(hideLoader, 10000);
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    function tick() {
      if (!running) return;
      currentTime += (targetTime - currentTime) * .08;
      const t = clamp(currentTime, 0, duration);
      if (!video.seeking && Math.abs(video.currentTime - t) > .01) video.currentTime = t;
      rafId = requestAnimationFrame(tick);
    }
    function start() {
      if (running || document.hidden || !duration) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    }
    function metadata() {
      if (metadataReady || !Number.isFinite(video.duration) || video.duration <= 0) return;
      metadataReady = true;
      duration = video.duration;
      video.pause();
      const st = ScrollTrigger.create({
        trigger: stage, start: "top top", end: "bottom bottom",
        onUpdate: self => { targetTime = clamp(self.progress * duration, 0, duration); }
      });
      targetTime = currentTime = clamp(st.progress * duration, 0, duration);
      if (!video.seeking) video.currentTime = currentTime;
      visibility = ScrollTrigger.create({
        trigger: stage, start: "top bottom", end: "bottom top",
        onToggle: self => { if (self.isActive) start(); else stop(); }
      });
      if (visibility.isActive) start();
    }
    video.addEventListener("loadedmetadata", metadata);
    video.addEventListener("progress", () => {
      if (!duration || !video.buffered.length || !progress) return;
      const pct = clamp(Math.round(video.buffered.end(video.buffered.length - 1) / duration * 100), 0, 100);
      progress.textContent = String(pct);
    });
    video.addEventListener("canplay", () => { clearTimeout(timeout); hideLoader(); });
    video.addEventListener("error", () => { clearTimeout(timeout); hideLoader(); stop(); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop(); else if (visibility?.isActive) start();
    });
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", () => { if (visibility?.isActive) start(); });
    window.addEventListener("touchstart", () => {
      const result = video.play();
      if (result && typeof result.then === "function") result.then(() => video.pause()).catch(() => {});
      else video.pause();
    }, { once: true, passive: true });
    video.src = VIDEO_SRC;
    video.load();
    if (video.readyState >= 1) metadata();
    if (video.readyState >= 3) { clearTimeout(timeout); hideLoader(); }
  }
  function init() {
    if (initialized) return;
    initialized = true;
    initReveal();
    const video = document.getElementById("tn-stage-video");
    const wrapper = stage?.querySelector(".tn-stage__video-wrapper");
    const viewport = stage?.querySelector(".tn-stage__viewport");
    if (!video || !wrapper || !viewport) return;
    if (staticMode) { video.poster = STATIC_POSTER; return; }
    initTimeline(viewport);
    initVideo(video);
  }
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();

