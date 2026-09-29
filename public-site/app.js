(() => {
  "use strict";
  const SUPABASE_URL = "https://dfbeerxqqfqkwlljrjko.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5EXohJOdj_5I1nW9ahgdDg_f5ZHiHhj";
  const TABLE_URL = SUPABASE_URL + "/rest/v1/tomenota_publications";
  const grid = document.getElementById("news-grid");
  const status = document.getElementById("status-message");
  const search = document.getElementById("search");
  const cityFilter = document.getElementById("city-filter");
  const sectionFilter = document.getElementById("section-filter");
  const count = document.getElementById("result-count");
  let publications = [];

  document.getElementById("year").textContent = String(new Date().getFullYear());
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("visible", Boolean(message));
    status.classList.toggle("error", Boolean(isError));
  }
  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Fortaleza" }).format(date);
  }
  function sectionName(value) {
    const names = { noticias: "Notícia", vagas: "Vaga", comunidade: "Comunidade", eleicoes: "Eleições", servicos: "Serviços" };
    return names[value] || "Notícia";
  }
  function articleUrl(publication) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("noticia", publication.slug);
    url.hash = "";
    return url.href;
  }
  function safeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch { return ""; }
  }
  function renderCard(publication) {
    const card = el("article", "news-card");
    const link = el("a", "card-link");
    link.href = articleUrl(publication);
    const imageUrl = safeImageUrl(publication.cover_url);
    if (imageUrl) {
      const image = el("img", "card-image");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      link.append(image);
    } else {
      const placeholder = el("div", "card-placeholder", "tn");
      placeholder.setAttribute("aria-hidden", "true");
      link.append(placeholder);
    }
    const body = el("div", "card-body");
    const meta = el("div", "card-meta");
    meta.append(el("span", "card-section", sectionName(publication.section)));
    meta.append(el("span", "meta-dot"));
    meta.append(el("time", "", formatDate(publication.published_at)));
    body.append(meta);
    body.append(el("h3", "card-title", publication.title));
    if (publication.summary) body.append(el("p", "card-summary", publication.summary));
    if (publication.city) body.append(el("span", "card-city", publication.city));
    link.append(body);
    card.append(link);
    return card;
  }
  function renderList() {
    const term = search.value.trim().toLocaleLowerCase("pt-BR");
    const city = cityFilter.value;
    const section = sectionFilter.value;
    const visible = publications.filter((item) => {
      const text = [item.title, item.summary, item.body, item.city, item.section].join(" ").toLocaleLowerCase("pt-BR");
      return (!term || text.includes(term)) && (!city || item.city === city) && (!section || item.section === section);
    });
    grid.replaceChildren();
    count.textContent = visible.length ? visible.length + (visible.length === 1 ? " matéria" : " matérias") : "";
    if (!visible.length) {
      const empty = el("div", "empty-state");
      empty.append(el("strong", "", publications.length ? "Nenhum resultado encontrado." : "A redação ainda não publicou notícias."));
      empty.append(el("p", "", publications.length ? "Tente mudar os filtros ou fazer outra busca." : "Assim que uma matéria for aprovada pela redação, ela aparecerá nesta página."));
      grid.append(empty);
      return;
    }
    visible.forEach((publication) => grid.append(renderCard(publication)));
  }
  function renderArticle(publication) {
    const main = document.querySelector("main");
    main.replaceChildren();
    const wrapper = el("article", "wrap article-view");
    const back = el("a", "back-link", "← Todas as notícias");
    back.href = window.location.pathname;
    wrapper.append(back);
    if (!publication) {
      const notFound = el("div", "article-error");
      notFound.append(el("h1", "", "Notícia não encontrada"));
      notFound.append(el("p", "", "Ela pode ter sido removida ou ainda não está publicada."));
      wrapper.append(notFound);
      main.append(wrapper);
      document.title = "Notícia não encontrada — Tome Nota News";
      return;
    }
    wrapper.append(el("p", "eyebrow", sectionName(publication.section) + (publication.city ? " · " + publication.city : "")));
    wrapper.append(el("h1", "", publication.title));
    if (publication.summary) wrapper.append(el("p", "article-summary", publication.summary));
    wrapper.append(el("p", "card-meta", formatDate(publication.published_at)));
    const imageUrl = safeImageUrl(publication.cover_url);
    if (imageUrl) {
      const image = el("img", "article-cover");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      wrapper.append(image);
    }
    wrapper.append(el("div", "article-body", publication.body || ""));
    const share = el("a", "article-share", "Compartilhar no WhatsApp");
    share.href = "https://wa.me/?text=" + encodeURIComponent(publication.title + " — " + articleUrl(publication));
    share.target = "_blank";
    share.rel = "noopener noreferrer";
    wrapper.append(share);
    main.append(wrapper);
    document.title = publication.title + " — Tome Nota News";
  }
  function fillCities() {
    const current = cityFilter.value;
    cityFilter.replaceChildren(new Option("Todas as cidades", ""));
    const cities = Array.from(new Set(publications.map((item) => item.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
    cities.forEach((city) => cityFilter.add(new Option(city, city)));
    if (cities.includes(current)) cityFilter.value = current;
  }
  async function fetchPublications() {
    const query = new URLSearchParams({ select: "slug,title,summary,body,city,section,cover_url,published_at", order: "published_at.desc", limit: "60" });
    const response = await fetch(TABLE_URL + "?" + query.toString(), {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Não foi possível carregar as notícias.");
    return response.json();
  }
  async function start() {
    search.addEventListener("input", renderList);
    cityFilter.addEventListener("change", renderList);
    sectionFilter.addEventListener("change", renderList);
    try {
      publications = await fetchPublications();
      fillCities();
      const slug = new URLSearchParams(window.location.search).get("noticia");
      if (slug) renderArticle(publications.find((item) => item.slug === slug) || null);
      else { showStatus("", false); renderList(); }
    } catch {
      showStatus("Não foi possível carregar o conteúdo agora. Tente novamente em instantes.", true);
      grid.replaceChildren();
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  start();
})();
