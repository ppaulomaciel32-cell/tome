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
  const localityValue = document.documentElement?.dataset?.localidade || new URLSearchParams(location.search).get("localidade");
  const locality = ["sao-goncalo","pecem","taiba","croata","paracuru","regiao"].includes(localityValue) ? localityValue : "";
  let feed;
  let initial = true;
  const pageSize = 12;
  let loading = false;
  let searchTerm = "";
  let listVersion = 0;
  let listController = null;
  let debounceTimer = null;
  let observer = null;
  let failed = false;
  let cutoff = new Date().toISOString();
  let lastHighlightBatch = 0;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function articleUrl(item) {
    if (config.builtSlugs?.includes(item.slug)) return new URL("/noticia/" + encodeURIComponent(item.slug) + "/", config.siteUrl).href;
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
  async function request(query, parentSignal, countExact = false) {
    query.set("status", "eq.published");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (parentSignal?.aborted) cancel();
    else parentSignal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(table + "?" + query, {
        headers: { apikey: config.supabaseAnonKey, Authorization: "Bearer " + config.supabaseAnonKey, Accept: "application/json", ...(countExact ? { Prefer: "count=exact" } : {}) },
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("Publications unavailable");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Invalid response");
      if (countExact) {
        const range = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(response.headers.get("Content-Range") || "");
        if (!range || !Number.isSafeInteger(Number(range[1]))) throw new Error("Missing exact count");
        return { items: data, total: Number(range[1]) };
      }
      return data;
    } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", cancel); }
  }
  function listQuery() {
    const query = new URLSearchParams({ select: publicFields, order: "published_at.desc,slug.asc", limit: String(initial ? 24 : pageSize), offset: String(feed.offset), published_at: "lte." + cutoff });
    if (locality) query.set("localidade", "eq." + locality);
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
  function updateList() {
    count.textContent = feed.count + " de " + feed.total + (feed.total === 1 ? " matéria" : " matérias");
    more.hidden = feed.done;
    more.textContent = "Carregar mais notícias";
    status.classList.remove("error");
    status.classList.toggle("visible", feed.done);
    status.textContent = feed.done ? "Você está em dia" : "";
    if (!feed.count && !grid.firstChild) {
      const empty = el("div", "empty-state");
      empty.append(el("strong", "", searchTerm ? "Nenhum resultado encontrado." : "A redação ainda não publicou notícias."));
      empty.append(el("p", "", searchTerm ? "Tente outra busca." : "As matérias aprovadas aparecerão aqui."));
      grid.append(empty);
    }
  }
  function card(item) {
      const card = el("article", "news-card");
      const link = el("a", "card-link");
      link.href = articleUrl(item);
      const cover = imageUrl(item.capa);
      const image = el("img", "card-image");
      image.src = cover || "/assets/images/og-tome-nota.png"; image.alt = item.titulo; image.loading = "lazy"; image.decoding = "async";
      image.setAttribute("loading", "lazy");
      image.width = 800; image.height = 450;
      if (/^https:\/\/bot\.tomezap\.com\.br\/imagens\/[a-f0-9]{32}-1600\.jpg$/.test(cover)) {
        image.srcset = cover.replace("-1600.jpg", "-800.webp") + " 800w, " + cover + " 1600w";
        image.sizes = "(max-width: 639px) calc(100vw - 30px), (max-width: 959px) 46vw, 360px";
      }
      link.append(image);
      const body = el("div", "card-body");
      const time = el("time", "card-meta", dateText(item.publicado_em));
      if (item.publicado_em) time.dateTime = item.publicado_em;
      body.append(time, el("h3", "card-title", item.titulo), el("p", "card-summary", item.resumo));
      link.append(body); card.append(link); return card;
  }
  let regularCards = 0;
  function feedAd() {
    const aside = el("aside", "feed-ad"); aside.setAttribute("aria-label", "Publicidade");
    aside.append(el("span", "ad-label", "Publicidade"));
    const house = el("div", "house-ad");
    house.append(el("span", "house-ad-brand", "TOME NOTA · COMUNIDADE"), el("h3", "", "Sua marca, perto de quem vive aqui."));
    const contact = el("a", "house-ad-link", "Anuncie no Tome Nota"); contact.href = "/contato.html"; house.append(contact);
    const ins = el("ins", "adsbygoogle"); ins.dataset.adPosition = "home"; ins.dataset.adClient = config.adClient;
    ins.dataset.adSlot = config.adSlots?.home || "0000000000";
    ins.dataset.adFormat = "horizontal"; ins.dataset.fullWidthResponsive = "true"; ins.hidden = true; ins.style.display = "block";
    aside.append(house, ins); return aside;
  }
  function appendCards(items) {
    items.forEach(item => {
      grid.append(card(item)); regularCards++;
      if (regularCards >= 6 && (regularCards - 6) % 12 === 0) grid.append(feedAd());
    });
    window.TNNAds?.refresh();
  }
  function skeletons() {
    const nodes = Array.from({length: 3}, () => {
      const node = el("div", "news-card news-skeleton"); node.setAttribute("aria-hidden", "true");
      node.append(el("div", "card-placeholder"), el("div", "card-body")); grid.append(node); return node;
    });
    return () => nodes.forEach(node => node.remove());
  }
  async function highlights(version, signal) {
    if (searchTerm || !feed.highlightsDue || lastHighlightBatch === feed.batches) return;
    lastHighlightBatch = feed.batches;
    const query = new URLSearchParams({select: publicFields, order: "published_at.desc,slug.asc", limit: "100", and: "(published_at.gte." + new Date(Date.now() - 30 * 86400000).toISOString() + ",published_at.lte." + cutoff + ")"});
    if (locality) query.set("localidade", "eq." + locality);
    try {
      const pool = await request(query, signal);
      if (version !== listVersion) return;
      const selected = feed.highlights(pool);
      if (!selected.length) return;
      const block = el("section", "feed-highlights"); block.setAttribute("aria-label", "Destaques do Tome Nota");
      block.append(el("h2", "", "Destaques do Tome Nota"), el("p", "", "Outras histórias da região, publicadas nos últimos 30 dias."));
      const cards = el("div", "highlights-grid"); selected.forEach(item => cards.append(card(item))); block.append(cards); grid.append(block);
    } catch { /* Destaques são opcionais: a lista e o botão continuam funcionando. */ }
  }
  function observeEnd() {
    observer?.disconnect();
    if (!observer || failed || feed.done || loading || debounceTimer !== null) return;
    observer.observe(more);
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
    if (loading || feed.done || debounceTimer !== null) return;
    const version = listVersion;
    const controller = new AbortController();
    listController = controller;
    loading = true; failed = false; observer?.disconnect();
    const removeSkeletons = skeletons();
    grid.setAttribute("aria-busy", "true");
    more.disabled = true; status.classList.add("visible");
    status.textContent = "Carregando notícias...";
    try {
      const limit = initial ? 24 : pageSize;
      const result = await request(listQuery(), controller.signal, true);
      if (version !== listVersion) return;
      const { items } = result;
      removeSkeletons(); appendCards(feed.accept(items, result.total, limit)); initial = false;
      await highlights(version, controller.signal);
      if (version !== listVersion) return;
      updateList();
    } catch {
      if (version !== listVersion || controller.signal.aborted) return;
      failed = true;
      status.textContent = "Não foi possível carregar. Sua lista continua aqui.";
      status.classList.add("visible", "error"); more.hidden = false; more.textContent = "Tentar de novo";
    } finally {
      removeSkeletons();
      if (version === listVersion) { loading = false; more.disabled = false; grid.setAttribute("aria-busy", "false"); observeEnd(); }
    }
  }
  function searchChanged() {
    const next = search.value.trim().slice(0, 100);
    if (next === searchTerm) return;
    clearTimeout(debounceTimer);
    searchTerm = next; listVersion++;
    listController?.abort();
    observer?.disconnect(); feed = new window.TNNFeedModel(); initial = true; regularCards = 0; lastHighlightBatch = 0;
    cutoff = new Date().toISOString(); loading = false; failed = false;
    more.hidden = true; grid.replaceChildren(); count.textContent = "";
    status.classList.remove("error"); status.classList.add("visible");
    status.textContent = "Buscando notícias...";
    debounceTimer = setTimeout(() => { debounceTimer = null; loadList(); }, 300);
  }
  if (document.getElementById("article-view") || slug) renderArticle();
  else {
    feed = new window.TNNFeedModel();
    if (window.IntersectionObserver) {
      try { observer = new window.IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && !failed) loadList();
      }, {rootMargin: "240px 0px"}); } catch { /* Botão é a alternativa permanente. */ }
    }
    search.addEventListener("input", searchChanged);
    more.addEventListener("click", loadList);
    const seedNode = document.getElementById("news-seed");
    let seed;
    try { seed = JSON.parse(seedNode?.textContent || "null"); } catch { seed = null; }
    if (seed && Array.isArray(seed.items) && Number.isSafeInteger(seed.total) && seed.total >= seed.items.length) {
      cutoff = seed.cutoff || cutoff; feed.accept(seed.items, seed.total, 24); initial = false;
      // O HTML do build já contém estes cartões. Acrescentamos publicidade sem removê-los.
      regularCards = seed.items.length;
      status.classList.add("status-message"); updateList(); window.TNNAds?.refresh(); observeEnd();
    } else { grid.replaceChildren(); loadList(); }
  }
})();

