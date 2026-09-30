(() => {
  "use strict";
  const KEY = "tnn_cookie_consent";
  let choice = null;
  function read() {
    try { const saved = localStorage.getItem(KEY); return ["all", "essential"].includes(saved) ? saved : null; }
    catch { return null; }
  }
  function notify() {
    window.dispatchEvent(new CustomEvent("tnn:consent", { detail: choice }));
  }
  function choose(value) {
    const previous = choice;
    choice = value;
    try { localStorage.setItem(KEY, value); } catch { /* Keep this choice in memory if storage is disabled. */ }
    document.getElementById("cookie-banner")?.remove();
    notify();
    // A new document discards any third-party scripts already loaded before withdrawal.
    if (previous === "all" && value === "essential") window.location.reload();
  }
  function show() {
    if (document.getElementById("cookie-banner")) return;
    const banner = document.createElement("section");
    banner.id = "cookie-banner";
    banner.className = "cookie-banner";
    banner.setAttribute("aria-label", "Preferências de cookies");
    const content = document.createElement("div");
    content.className = "wrap cookie-inner";
    const copy = document.createElement("p");
    copy.append("Usamos armazenamento essencial para lembrar sua escolha. Publicidade só será ativada com sua autorização. ");
    const link = document.createElement("a");
    link.href = "./politica-de-cookies.html";
    link.textContent = "Política de Cookies";
    copy.append(link);
    const actions = document.createElement("div");
    actions.className = "cookie-actions";
    [["Aceitar todos", "all"], ["Só essenciais", "essential"]].forEach(([label, value]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => choose(value));
      actions.append(button);
    });
    content.append(copy, actions);
    banner.append(content);
    document.body.append(banner);
    if (choice) actions.querySelector("button").focus();
  }
  choice = read();
  window.TNNConsent = Object.freeze({ get: () => choice, show });
  document.querySelectorAll("[data-cookie-preferences]").forEach(button => button.addEventListener("click", show));
  window.addEventListener("storage", event => {
    if (event.key !== KEY && event.key !== null) return;
    const previous = choice;
    choice = read();
    if (previous === "all" && choice !== "all") { window.location.reload(); return; }
    notify();
    if (!choice) show();
    else document.getElementById("cookie-banner")?.remove();
  });
  if (!choice) show();
  notify();
})();
