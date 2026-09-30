(() => {
  "use strict";
  document.querySelectorAll("[data-year]").forEach(node => { node.textContent = String(new Date().getFullYear()); });
  document.querySelectorAll("[data-contact-email]").forEach(node => {
    const email = window.TNN_CONFIG.contactEmail;
    node.textContent = email;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && node.tagName === "A") node.href = "mailto:" + email;
  });
})();
