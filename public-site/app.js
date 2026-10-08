(() => {
  "use strict";
  const config = window.TNN_CONFIG;
  const table = config.supabaseUrl + "/rest/v1/tomenota_publications";
  // PostgREST aliases preserve the existing schema and its RLS policies.
  const publicFields = "id,titulo:title,resumo:summary,capa:cover_url,slug,publicado_em:published_at";
  const grid = document.getElementById("news-grid");
  const status = document.getElementById("status-message");
  const search = document.getElementById("search");
  const count = document.getElementById("result-count");
  const more = document.getElementById("load-more");
  const slug = new URLSearchParams(location.search).get("slug") || new URLSearchParams(location.search).get("noticia");
  let publications = [];
  let offset = 0;
  let loading = false;
  let searchTerm = "";
  let listVersion = 0;
  let listController = null;
  let debounceTimer = null;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function articleUrl(item) {
    const url = new URL("/noticia.html", config.siteUrl);
    url.searchParams.set("slug", item.slug);
    return url.href;
  }
  function imageUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
  }
  function dateText(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.valueOf()) ?
      new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Fortaleza" }).format(date) : "";
  }
  function adSlot() {
    const aside = el("aside", "ad-space ad-in-article");
    aside.hidden = true; // ads.js reveals only a configured manual slot.
    aside.setAttribute("aria-label", "Publicidade no meio do artigo");
    aside.append(el("span", "ad-label", "Publicidade"));
    const ins = el("ins", "adsbygoogle");
    ins.style.display = "block";
    ins.dataset.adClient = config.adClient;
    // ADSENSE PLACEHOLDER: substitute this in-article slot ID.
    ins.dataset.adSlot = "0000000000";
    ins.dataset.adLayout = "in-article";
    ins.dataset.adFormat = "fluid";
    aside.append(ins);
    return aside;
  }
  async function request(query, parentSignal) {
    query.set("status", "eq.published");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (parentSignal?.aborted) cancel();
    else parentSignal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(table + "?" + query, {
        headers: { apikey: config.supabaseAnonKey, Authorization: "Bearer " + config.supabaseAnonKey, Accept: "application/json" },
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("Publications unavailable");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Invalid response");
      return data;
    } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", cancel); }
  }
  function listQuery() {
    const query = new URLSearchParams({ select: publicFields, order: "published_at.desc,slug.asc", limit: "60", offset: String(offset) });
    if (searchTerm.length >= 3) query.set("search", "wfts(portuguese)." + searchTerm);
    else if (searchTerm) {
      // Quote PostgREST grammar, then URLSearchParams handles URL encoding once.
      const quote = value => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      // PostgREST replaces * with % in LIKE patterns, even when quoted. Use a
      // literal regex for a short term containing * so it cannot become a wildcard.
      const literalStar = searchTerm.includes("*");
      const pattern = literalStar ? searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") :
        "%" + searchTerm.replace(/[\\%_]/g, "\\$&") + "%";
      const operator = literalStar ? "imatch" : "ilike";
      query.set("or", "(title." + operator + "." + quote(pattern) + ",summary." + operator + "." + quote(pattern) + ")");
    }
    return query;
  }
  function renderList() {
    const visible = publications;
    grid.replaceChildren();
    count.textContent = visible.length + (visible.length === 1 ? " matéria" : " matérias");
    if (!visible.length) {
      const empty = el("div", "empty-state");
      empty.append(el("strong", "", searchTerm ? "Nenhum resultado encontrado." : "A redação ainda não publicou notícias."));
      empty.append(el("p", "", searchTerm ? "Tente outra busca." : "As matérias aprovadas aparecerão aqui."));
      grid.append(empty);
    }
    visible.forEach(item => {
      const card = el("article", "news-card");
      const link = el("a", "card-link");
      link.href = "./noticia.html?slug=" + encodeURIComponent(item.slug);
      const cover = imageUrl(item.capa);
      if (cover) {
        const image = el("img", "card-image");
        image.src = cover; image.alt = item.titulo; image.loading = "lazy"; image.decoding = "async";
        link.append(image);
      }
      const body = el("div", "card-body");
      const time = el("time", "card-meta", dateText(item.publicado_em));
      if (item.publicado_em) time.dateTime = item.publicado_em;
      body.append(time, el("h3", "card-title", item.titulo), el("p", "card-summary", item.resumo));
      link.append(body); card.append(link); grid.append(card);
    });
  }
  function meta(selector, content) { document.querySelector(selector)?.setAttribute("content", content); }
  function articleMetadata(item) {
    const url = articleUrl(item);
    const cover = imageUrl(item.capa) || config.siteUrl + "/assets/images/og-tome-nota.png";
    const title = item.titulo + " | Tome Nota News";
    const description = item.resumo || item.titulo;
    document.title = title;
    document.querySelector('link[rel="canonical"]').href = url;
    meta('meta[name="description"]', description);
    for (const [key,value] of Object.entries({type:"article",title,description,url,image:cover,"image:alt":item.titulo})) meta('meta[property="og:' + key + '"]', value);
    for (const [key,value] of Object.entries({title,description,image:cover})) meta('meta[name="twitter:' + key + '"]', value);
    const schema = {
      "@context": "https://schema.org", "@type": "NewsArticle",
      headline: item.titulo, description, image: [cover],
      author: { "@type": item.autor === "Tome Nota News" ? "Organization" : "Person", name: item.autor },
      publisher: { "@type": "Organization", name: item.editor,
        logo: { "@type": "ImageObject", url: config.siteUrl + "/assets/images/og-tome-nota.png" } },
      mainEntityOfPage: { "@type": "WebPage", "@id": url }
    };
    if (item.publicado_em && !Number.isNaN(new Date(item.publicado_em).valueOf())) schema.datePublished = new Date(item.publicado_em).toISOString();
    const json = el("script");
    json.type = "application/ld+json";
    json.id = "news-schema";
    json.textContent = JSON.stringify(schema).replace(/</g, "\\u003c");
    document.getElementById("news-schema")?.remove();
    document.head.append(json);
  }
  async function renderArticle() {
    if (grid) {
      // Compatibility with already shared /?noticia= links.
      const main = document.getElementById("conteudo");
      main.replaceChildren(el("article", "wrap article-view"));
      main.firstChild.id = "article-view";
      main.firstChild.append(el("h1", "", "Carregando notícia..."));
    }
    const wrapper = document.getElementById("article-view");
    try {
      if (!slug || slug.length > 240) throw new Error("Missing slug");
      // Full text and editorial credits are requested only for an individual public story.
      const query = new URLSearchParams({ select: publicFields + ",texto:body,autor:author,editor:publisher", slug: "eq." + slug, limit: "1" });
      const items = await request(query);
      wrapper.replaceChildren();
      const back = el("a", "back-link", "Todas as notícias"); back.href = "./"; wrapper.append(back);
      if (!items.length) {
        wrapper.append(el("h1", "", "Notícia não encontrada"), el("p", "", "Ela pode ter sido removida ou ainda não está publicada."));
        document.title = "Notícia não encontrada | Tome Nota News";
        const robots = el("meta"); robots.name = "robots"; robots.content = "noindex"; document.head.append(robots);
        return;
      }
      const item = items[0];
      wrapper.append(el("h1", "", item.titulo), el("p", "article-summary", item.resumo));
      const time = el("time", "", dateText(item.publicado_em)); if (item.publicado_em) time.dateTime = item.publicado_em;
      const credits = el("p", "card-meta"); credits.append("Por " + item.autor + " · ", time); wrapper.append(credits);
      const cover = imageUrl(item.capa);
      if (cover) { const image = el("img", "article-cover"); image.src = cover; image.alt = item.titulo; image.decoding = "async"; wrapper.append(image); }
      const body = el("div", "article-body");
      const paragraphs = String(item.texto || item.resumo || "").split(/\n\s*\n/).filter(Boolean);
      const middle = Math.max(1, Math.ceil(paragraphs.length / 2));
      paragraphs.forEach((text, index) => { body.append(el("p", "", text)); if (index + 1 === middle) body.append(adSlot()); });
      if (!paragraphs.length) body.append(adSlot());
      wrapper.append(body);
      const share = el("a", "article-share", "Compartilhar no WhatsApp");
      share.href = "https://wa.me/?text=" + encodeURIComponent(item.titulo + " " + articleUrl(item));
      share.target = "_blank"; share.rel = "noopener noreferrer"; wrapper.append(share);
      articleMetadata(item);
      window.TNNAds.refresh();
    } catch {
      wrapper.replaceChildren(el("h1", "", "Não foi possível carregar a notícia"), el("p", "", "Tente novamente em instantes."));
      document.title = "Conteúdo indisponível | Tome Nota News";
      const back = el("a", "back-link", "Voltar às notícias"); back.href = "./"; wrapper.append(back);
    }
  }
  async function loadList() {
    if (loading || debounceTimer !== null) return;
    const version = listVersion;
    const controller = new AbortController();
    listController = controller;
    loading = true; more.disabled = true; status.classList.add("visible");
    status.textContent = "Carregando notícias...";
    try {
      const items = await request(listQuery(), controller.signal);
      if (version !== listVersion) return;
      publications.push(...items); offset += items.length;
      more.hidden = items.length < 60;
      more.textContent = "Carregar mais notícias";
      renderList(); status.classList.remove("visible", "error");
    } catch {
      if (version !== listVersion || controller.signal.aborted) return;
      status.textContent = "Não foi possível carregar as notícias. Tente novamente.";
      status.classList.add("visible", "error"); more.hidden = false; more.textContent = "Tentar novamente";
    } finally { if (version === listVersion) { loading = false; more.disabled = false; } }
  }
  function searchChanged() {
    const next = search.value.trim().slice(0, 100);
    if (next === searchTerm) return;
    clearTimeout(debounceTimer);
    searchTerm = next; listVersion++;
    listController?.abort();
    publications = []; offset = 0; loading = false;
    more.hidden = true; grid.replaceChildren(); count.textContent = "";
    status.classList.remove("error"); status.classList.add("visible");
    status.textContent = "Buscando notícias...";
    debounceTimer = setTimeout(() => { debounceTimer = null; loadList(); }, 300);
  }
  if (document.getElementById("article-view") || slug) renderArticle();
  else { search.addEventListener("input", searchChanged); more.addEventListener("click", loadList); loadList(); }
})();

