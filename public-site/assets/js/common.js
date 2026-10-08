(() => {
  "use strict";
  document.querySelectorAll("[data-year]").forEach(node => { node.textContent = String(new Date().getFullYear()); });
  document.querySelectorAll("[data-contact-email]").forEach(node => {
    const email = String(window.TNN_CONFIG.contactEmail || "").trim();
    const block = node.closest("[data-contact-email-block]");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      (block || node).remove();
      return;
    }
    node.textContent = email;
    if (node.tagName === "A") node.href = "mailto:" + email;
    if (block) block.hidden = false;
  });
})();
