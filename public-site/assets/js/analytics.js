(() => {
  "use strict";
  // Medição de audiência (Google Analytics 4). Só carrega com "Aceitar todos".
  let loaded = false;
  function load() {
    const id = window.TNN_CONFIG?.gaId || "";
    if (loaded || !/^G-[A-Z0-9]{6,12}$/.test(id) || window.TNNConsent?.get() !== "all") return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id);
    const script = document.createElement("script");
    script.id = "tnn-analytics";
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    script.onerror = () => { script.remove(); loaded = false; };
    document.head.append(script);
  }
  // Retirar o consentimento recarrega a página (consent.js), descartando o script.
  window.addEventListener("tnn:consent", load);
  load();
})();
