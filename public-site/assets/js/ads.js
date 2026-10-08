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
      const hidden = !isConfigured(slot);
      slot.hidden = hidden;
      // Hide the label and reserved space too, including dynamically rendered articles.
      const space = slot.closest(".ad-space");
      if (space) space.hidden = hidden;
    });
  }
  function queueSlots() {
    if (window.TNNConsent?.get() !== "all") return;
    document.querySelectorAll("ins.adsbygoogle").forEach(slot => {
      if (!isConfigured(slot) ||
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
