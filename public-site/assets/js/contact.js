(() => {
  "use strict";
  const form = document.getElementById("contact-form");
  const status = document.getElementById("contact-status");
  const button = form.querySelector('button[type="submit"]');
  let sending = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const data = new FormData(form);
    if (data.get("website")) { status.textContent = "Não foi possível enviar a mensagem."; return; }
    const payload = Object.fromEntries(["nome", "email", "mensagem"].map(key => [key, String(data.get(key) || "").trim()]));
    if (Array.from(payload.nome).length < 2 || Array.from(payload.nome).length > 100 ||
        Array.from(payload.email).length < 5 || Array.from(payload.email).length > 120 ||
        Array.from(payload.mensagem).length < 10 || Array.from(payload.mensagem).length > 2000) {
      status.textContent = "Confira os tamanhos dos campos antes de enviar."; return;
    }
    sending = true;
    button.disabled = true;
    status.textContent = "Enviando mensagem...";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const config = window.TNN_CONFIG;
      const response = await fetch(config.supabaseUrl + "/rest/v1/mensagens_contato", {
        method: "POST", headers: { apikey: config.supabaseAnonKey,
          Authorization: "Bearer " + config.supabaseAnonKey, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(payload), signal: controller.signal, cache: "no-store"
      });
      if (!response.ok) throw new Error("send failed");
      form.reset();
      status.textContent = "Mensagem enviada. Obrigado por falar com a redação.";
    } catch {
      status.textContent = "Não conseguimos confirmar o envio. Confira sua conexão ou use o Instagram da redação.";
    } finally { clearTimeout(timer); sending = false; button.disabled = false; }
  });
})();
