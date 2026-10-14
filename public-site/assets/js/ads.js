(() => {
  "use strict";
  let loading = false;
  function isConfigured(slot) {
    return /^ca-pub-\d{16}$/.test(slot.dataset.adClient || "") &&
      /^\d{10}$/.test(slot.dataset.adSlot || "") && slot.dataset.adSlot !== "0000000000";
  }
  function prepareSlots(client) {
    document.querySelectorAll("ins.adsbygoogle").forEach(slot => {
      slot.dataset.adClient = client;
      const configured=window.TNN_CONFIG.adSlots?.[slot.dataset.adPosition];
      if(configured!==undefined)slot.dataset.adSlot=configured || '0000000000';
      const hidden = !isConfigured(slot);
      const feedSpace = slot.closest(".feed-ad");
      const feedReady = !hidden && window.TNNConsent?.get() === "all";
      slot.hidden = feedSpace ? !feedReady : hidden;
      if (feedSpace) {
        // Duas peças na mesma altura reservada; a troca não movimenta os cartões.
        const house = feedSpace.querySelector(".house-ad");
        if (house) house.hidden = feedReady;
      }
      // Hide the label and reserved space too, including dynamically rendered articles.
      const space = slot.closest(".ad-space");
      if (space) space.hidden = hidden;
    });
  }
  function queueSlots() {
    if (window.TNNConsent?.get() !== "all") return;
    document.querySelectorAll("ins.adsbygoogle").forEach(slot => {
      if (slot.hidden || !isConfigured(slot) ||
          slot.dataset.tnnQueued || slot.getAttribute("data-adsbygoogle-status")) return;
      slot.dataset.tnnQueued = "true";
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
      catch { delete slot.dataset.tnnQueued; }
    });
  }
  function loadAds() {
    const client = window.TNN_CONFIG.adClient;
    prepareSlots(client);
    if (window.TNNConsent?.get() !== "all" || !/^ca-pub-\d{16}$/.test(client)) return;
    // Na lista, só solicitamos anúncios quando há um espaço manual válido.
    // Sem ADSENSE_SLOT_HOME, o anúncio da casa permanece no lugar reservado.
    if(document.getElementById("news-grid") && ![...document.querySelectorAll('ins.adsbygoogle')].some(isConfigured))return;
    if(window.TNN_CONFIG.autoAds===false && ![...document.querySelectorAll('ins.adsbygoogle')].some(isConfigured))return;
    if (document.getElementById("tnn-adsense")) { queueSlots(); return; }
    if (loading) return;
    loading = true;
    const script = document.createElement("script");
    script.id = "tnn-adsense";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
    script.onload = queueSlots;
    script.onerror = () => { script.remove(); loading = false; };
    document.head.append(script);
  }
  window.TNNAds = Object.freeze({ load: loadAds, refresh: loadAds });
  window.addEventListener("tnn:consent", loadAds);
  loadAds();
})();
