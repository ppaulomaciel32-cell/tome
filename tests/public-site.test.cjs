const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../public-site");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
class Node {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
    this.attributes = {}; this.events = {}; this.textContent = ""; this.value = "";
    this.classes = new Set();
    this.classList = { add: (...v) => v.forEach(x => this.classes.add(x)),
      remove: (...v) => v.forEach(x => this.classes.delete(x)),
      toggle: (v, force) => force ? this.classes.add(v) : this.classes.delete(v) };
  }
  append(...nodes) { nodes.forEach(node => { if (typeof node !== "string") node.parent = this; this.children.push(node); }); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get firstChild() { return this.children[0]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  addEventListener(name, fn) { this.events[name] = fn; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector(selector) { return this.children.find(node => node.tagName === selector.toUpperCase()) || null; }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (selector === ".ad-space" && (node.className || "").split(/\s+/).includes("ad-space")) return node;
      if (selector === "[data-contact-email-block]" && "data-contact-email-block" in node.attributes) return node;
    }
    return null;
  }
  focus() {}
}
function all(node) { return [node, ...node.children.filter(x => x instanceof Node).flatMap(all)]; }
function environment(saved = null, blocked = false) {
  const body = new Node("body"), head = new Node("head"), ids = {}, meta = {}, events = {}, storage = {};
  if (saved) storage.tnn_cookie_consent = saved;
  const slots = [new Node("ins"), new Node("ins")];
  slots.forEach(slot => { slot.dataset.adClient = "ca-pub-1234567890123456"; slot.dataset.adSlot = "1234567890"; });
  slots.forEach(slot => {
    const space = new Node("aside"); space.className = "ad-space"; space.hidden = true;
    space.append(slot); body.append(space);
  });
  const document = { body, head, title: "", createElement: tag => new Node(tag),
    getElementById: id => ids[id] || [...all(body), ...all(head)].find(x => x.id === id) || null,
    querySelector: selector => meta[selector] || null,
    querySelectorAll: selector => selector === "ins.adsbygoogle" ? slots : [] };
  const window = { TNN_CONFIG: { siteUrl: "https://tome-nota-publico.onrender.com",
      supabaseUrl: "https://dfbeerxqqfqkwlljrjko.supabase.co", supabaseAnonKey: "anon-test",
      adClient: "ca-pub-1234567890123456", contactEmail: "[SUBSTITUIR PELO E-MAIL REAL]" },
    addEventListener: (name, fn) => { (events[name] ||= []).push(fn); },
    dispatchEvent: event => (events[event.type] || []).forEach(fn => fn(event)),
    location: { reload: () => { window.reloaded = true; } } };
  const context = vm.createContext({ window, document, URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout, Intl, console, location: { search: "" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => { if (blocked) throw Error("blocked"); return storage[key] || null; },
      setItem: (key, value) => { if (blocked) throw Error("blocked"); storage[key] = value; } } });
  return { context, window, document, slots, storage, ids, meta, body, head };
}
function run(env, file) { vm.runInContext(read(file), env.context, { filename: file }); }
function choose(env, label) {
  const button = all(env.body).find(node => node.tagName === "BUTTON" && node.textContent === label);
  assert.ok(button, "Consent choice exists"); button.events.click();
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("contact email appears only for a valid configured address", () => {
  for (const email of ["", "[SUBSTITUIR PELO E-MAIL REAL]", "redacao@example.com"]) {
    const env = environment();
    const block = new Node("span"), link = new Node("a");
    block.setAttribute("data-contact-email-block", ""); block.hidden = true;
    block.append(link); env.body.append(block);
    env.window.TNN_CONFIG.contactEmail = email;
    env.document.querySelectorAll = selector => selector === "[data-contact-email]" ? [link] : [];
    run(env, "assets/js/common.js");
    if (email === "redacao@example.com") {
      assert.equal(link.href, "mailto:redacao@example.com"); assert.equal(block.hidden, false);
    } else {
      assert.equal(env.body.children.includes(block), false); assert.equal(link.href, undefined);
    }
  }
});
test("seven HTML pages have metadata, one h1 and complete shared legal links", () => {
  const pages = fs.readdirSync(root).filter(p => p.endsWith(".html"));
  assert.equal(pages.length, 7);
  const titles = new Set(), descriptions = new Set();
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /<html lang="pt-BR">/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, file);
    assert.match(html, /name="viewport"/);
    assert.match(html, /ADSENSE VERIFICATION: cole aqui/);
    assert.equal((html.match(/name="google-adsense-account"/g) || []).length, 1);
    assert.match(html.split("</head>")[0], /<meta name="google-adsense-account" content="ca-pub-2000164835494228">/);
    assert.doesNotMatch(html, /SEU_ID_AQUI/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    for (const key of ["type", "site_name", "title", "description", "url", "image", "locale"])
      assert.match(html, new RegExp('property="og:' + key + '"'), file);
    for (const link of ["politica-de-privacidade", "termos-de-uso", "sobre", "contato", "politica-de-cookies"])
      assert.match(html.slice(html.indexOf("<footer")), new RegExp(link + "\\.html"), file);
    assert.equal((html.match(/<ins class="adsbygoogle"/g) || []).length, 2);
    assert.equal((html.match(/<aside hidden class="ad-space /g) || []).length, 2);
    assert.equal((html.match(/data-ad-client="ca-pub-2000164835494228"/g) || []).length, 2);
    assert.doesNotMatch(html, /<script[^>]+src="https:\/\/[^"]*google/);
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    const description = html.match(/name="description" content="([^"]+)"/)[1];
    assert.ok(!titles.has(title)); titles.add(title);
    assert.ok(!descriptions.has(description)); descriptions.add(description);
    for (const match of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g))
      assert.ok(fs.existsSync(path.join(root, match[1])), file + ": " + match[1]);
  }
});
test("public code contains only the anon JWT and narrowly selected fields", () => {
  const env = environment(); run(env, "assets/js/config.js");
  const key = env.window.TNN_CONFIG.supabaseAnonKey;
  const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  assert.equal(payload.role, "anon");
  for (const file of ["app.js", ...fs.readdirSync(path.join(root, "assets/js")).map(f => "assets/js/" + f)]) {
    new vm.Script(read(file));
    assert.doesNotMatch(read(file), /sb_secret_|SUPABASE_SERVICE_ROLE|select\s*\(\s*["']\*/);
  }
  assert.match(read("app.js"), /id,titulo:title,resumo:summary,capa:cover_url,slug,publicado_em:published_at/);
  const png = fs.readFileSync(path.join(root, "assets/images/og-tome-nota.png"));
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});
test("AdSense is blocked before consent and after essential-only choice", () => {
  const env = environment(); run(env, "assets/js/config.js"); run(env, "assets/js/consent.js"); run(env, "assets/js/ads.js");
  assert.equal(env.head.children.length, 0);
  choose(env, "Só essenciais");
  assert.equal(env.storage.tnn_cookie_consent, "essential");
  assert.equal(env.head.children.length, 0);
  assert.equal(env.document.getElementById("cookie-banner"), null);
});
test("valid client loads only after accepting; each slot is queued once", () => {
  const env = environment(); run(env, "assets/js/config.js"); run(env, "assets/js/consent.js"); run(env, "assets/js/ads.js");
  choose(env, "Aceitar todos");
  assert.equal(env.storage.tnn_cookie_consent, "all");
  assert.equal(env.head.children.length, 1);
  const script = env.head.firstChild;
  assert.match(script.src, /^https:\/\/pagead2\.googlesyndication\.com/);
  assert.equal(new URL(script.src).searchParams.get("client"), "ca-pub-2000164835494228");
  assert.ok(env.slots.every(slot => slot.hidden === false && slot.parent.hidden === false));
  script.onload();
  assert.equal(env.window.adsbygoogle.length, 2);
  env.window.TNNAds.refresh(); env.window.TNNAds.refresh();
  assert.equal(env.head.children.length, 1); assert.equal(env.window.adsbygoogle.length, 2);
  env.window.TNNConsent.show(); choose(env, "Só essenciais");
  assert.equal(env.window.reloaded, true);
});
test("saved refusal persists across pages; invalid consent and unavailable storage fail closed", () => {
  const refused = environment("essential"); run(refused, "assets/js/consent.js"); run(refused, "assets/js/ads.js");
  assert.equal(refused.document.getElementById("cookie-banner"), null);
  assert.equal(refused.head.children.length, 0);
  for (const env of [environment("invalid"), environment("all", true)]) {
    run(env, "assets/js/consent.js"); run(env, "assets/js/ads.js");
    assert.ok(env.document.getElementById("cookie-banner")); assert.equal(env.head.children.length, 0);
  }
});
test("placeholder clients never load ads, and placeholder slots are not queued", () => {
  const env = environment("all");
  env.window.TNN_CONFIG.adClient = "ca-pub-invalido";
  run(env, "assets/js/consent.js"); run(env, "assets/js/ads.js");
  assert.equal(env.head.children.length, 0);
  assert.ok(env.slots.every(slot => slot.hidden && slot.parent.hidden));
  env.window.TNN_CONFIG.adClient = "ca-pub-1234567890123456";
  env.slots.forEach(slot => { slot.dataset.adSlot = "0000000000"; });
  env.window.TNNAds.refresh(); env.head.firstChild.onload();
  assert.equal(env.window.adsbygoogle, undefined);
  assert.ok(env.slots.every(slot => slot.hidden && slot.parent.hidden));
  assert.equal(env.head.children.length, 1, "Auto ads script loads after consent even without manual slots");
  const added = new Node("ins"), space = new Node("aside");
  added.dataset.adSlot = "0000000000"; space.className = "ad-space"; space.append(added); env.slots.push(added);
  env.window.TNNAds.refresh();
  assert.equal(space.hidden, true, "Later article placeholders are also hidden");
  assert.equal(env.window.adsbygoogle, undefined);
});
test("individual article is queried by slug, safely rendered, with live metadata and NewsArticle", async () => {
  const env = environment();
  const article = new Node("article"); env.ids["article-view"] = article;
  env.context.location.search = "?slug=noticia-antiga";
  const canonical = new Node("link"); env.meta['link[rel="canonical"]'] = canonical;
  for (const key of ["title", "description", "url", "image", "image:alt", "type"])
    env.meta['meta[property="og:' + key + '"]'] = new Node("meta");
  let query;
  env.context.fetch = async url => {
    query = new URL(url);
    return { ok: true, json: async () => [{ id: "uuid", titulo: "Título <script> não executado",
      resumo: "Resumo seguro", slug: "noticia-antiga", publicado_em: "2026-09-29T12:00:00Z",
      capa: "https://example.com/foto.jpg", texto: "Primeiro parágrafo.\n\nSegundo parágrafo.",
      autor: "Tome Nota News", editor: "Tome Nota News" }] };
  };
  env.window.TNNAds = { refresh() {} };
  run(env, "app.js"); await flush();
  assert.equal(query.searchParams.get("slug"), "eq.noticia-antiga");
  assert.equal(query.searchParams.get("limit"), "1");
  assert.equal(all(article).filter(n => n.tagName === "H1").length, 1);
  assert.equal(all(article).filter(n => n.tagName === "SCRIPT").length, 0);
  assert.equal(all(article).filter(n => n.tagName === "INS").length, 1);
  assert.equal(all(article).find(n => n.tagName === "INS").parent.hidden, true);
  const image = all(article).find(n => n.tagName === "IMG"); assert.ok(image.alt);
  const schema = JSON.parse(env.document.getElementById("news-schema").textContent);
  assert.equal(schema["@type"], "NewsArticle"); assert.equal(schema.author.name, "Tome Nota News");
  assert.equal(schema.datePublished, "2026-09-29T12:00:00.000Z");
  assert.equal(schema.image[0], "https://example.com/foto.jpg");
  assert.match(canonical.href, /noticia\.html\?slug=noticia-antiga/);
});
test("missing article gets noindex and a single h1; network errors show a recovery link", async () => {
  for (const fails of [false, true]) {
    const env = environment(); const article = new Node("article"); env.ids["article-view"] = article;
    env.context.location.search = "?slug=ausente";
    env.context.fetch = async () => { if (fails) throw Error("offline"); return { ok:true, json:async () => [] }; };
    run(env, "app.js"); await flush();
    assert.equal(all(article).filter(n => n.tagName === "H1").length, 1);
    assert.ok(all(article).some(n => n.tagName === "A"));
    if (!fails) assert.ok(env.head.children.some(n => n.content === "noindex"));
  }
});
test("contact uses POST minimal, trimmed fields, no data read, and duplicate-submit guard", async () => {
  const env = environment(), form = new Node("form"), status = new Node("p"), button = new Node("button");
  form.querySelector = () => button; form.reportValidity = () => true; form.reset = () => { form.wasReset = true; };
  form.values = { nome:" Maria ", email:" maria@example.com ", mensagem:" Uma pauta da comunidade. ", website:"" };
  env.ids["contact-form"] = form; env.ids["contact-status"] = status;
  env.context.FormData = class { constructor(f) { this.values = f.values; } get(key) { return this.values[key]; } };
  let calls = 0, request, resolve;
  env.context.fetch = async (url, options) => {
    calls++; request = { url, options };
    return new Promise(done => { resolve = done; });
  };
  run(env, "assets/js/contact.js");
  const event = { preventDefault() {} };
  const pending = form.events.submit(event); await form.events.submit(event);
  assert.equal(calls, 1); assert.equal(button.disabled, true);
  assert.equal(request.options.method, "POST"); assert.equal(request.options.headers.Prefer, "return=minimal");
  assert.equal(JSON.parse(request.options.body).nome, "Maria");
  assert.ok(!request.url.includes("select")); resolve({ ok:true }); await pending;
  assert.equal(form.wasReset, true); assert.equal(button.disabled, false); assert.match(status.textContent, /Mensagem enviada/);
  env.context.fetch = async () => ({ ok:false }); await form.events.submit(event);
  assert.match(status.textContent, /Não conseguimos/);
});
test("headers, robots, sitemap and contact SQL are scoped and explicit", () => {
  assert.match(read("_headers"), /X-Frame-Options: DENY/);
  assert.match(read("_headers"), /frame-ancestors 'none'/);
  assert.match(read("_headers"), /object-src 'none'/);
  assert.match(read("robots.txt"), /Disallow: \/admin/);
  assert.match(read("robots.txt"), /Disallow: \/assets\/js\/config.js/);
  assert.equal(read("ads.txt").trim(), "google.com, pub-2000164835494228, DIRECT, f08c47fec0942fa0");
  assert.equal((read("sitemap.xml").split("<!--")[0].match(/<url>/g) || []).length, 6);
  const sql = fs.readFileSync(path.resolve(root, "../database/mensagens_contato.sql"), "utf8");
  assert.match(sql, /for insert to anon/i); assert.doesNotMatch(sql, /for select/i);
  assert.match(sql, /grant insert \(nome, email, mensagem\)/i);
  assert.match(sql, /between 10 and 2000/);
  assert.match(sql, /char_length\(nome\) <= 100/);
  assert.match(sql, /char_length\(mensagem\) <= 2000/);
});
