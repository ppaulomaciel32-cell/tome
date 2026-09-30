// Optional browser verification; no runtime dependency is added to the site.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../public-site");
const shots = process.env.TNN_SCREENSHOT_DIR || "/tmp/tnn-motion-screenshots";
const executablePath = process.env.TNN_CHROME_EXECUTABLE;
const mime = { ".html":"text/html", ".css":"text/css", ".js":"application/javascript",
  ".svg":"image/svg+xml", ".png":"image/png", ".xml":"application/xml", ".txt":"text/plain", ".webmanifest":"application/manifest+json" };
const article = { id:"00000000-0000-4000-8000-000000000001", titulo:"Notícia de teste",
  resumo:"Teste da integração existente, sem gravar dados.", capa:null, slug:"teste-motion",
  publicado_em:"2026-09-30T12:00:00Z", texto:"Primeiro parágrafo.\n\nSegundo parágrafo.",
  autor:"Tome Nota News", editor:"Tome Nota News" };
const server = http.createServer((request,response) => {
  const url = new URL(request.url, "http://localhost");
  const file = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type":mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});
let browser;
let lastPage;
const errors = [];
async function check(label, fn) { await fn(); console.log("PASS " + label); }
async function scroll(page, top) {
  await page.evaluate(top => { window.scrollTo({top, behavior:"instant"}); window.ScrollTrigger?.update(); }, top);
  await page.waitForTimeout(2200);
}
(async () => {
  fs.mkdirSync(shots,{recursive:true});
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const launch = { headless:true, args:["--no-sandbox","--ignore-certificate-errors"] };
  if (executablePath) launch.executablePath = executablePath;
  else launch.channel = "chrome";
  if (process.env.HTTPS_PROXY) launch.proxy = { server:process.env.HTTPS_PROXY, bypass:"localhost,127.0.0.1" };
  browser = await chromium.launch(launch);
  console.log("Browser " + browser.version());
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport:{width:1440,height:900}, ignoreHTTPSErrors:true, ...options });
    await ctx.addInitScript(() => localStorage.setItem("tnn_cookie_consent","essential"));
    await ctx.route("**/*.supabase.co/rest/v1/tomenota_publications**", route => route.fulfill({
      status:200, contentType:"application/json", body:JSON.stringify([article])
    }));
    return ctx;
  }
  const ctx = await context();
  const page = lastPage = await ctx.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(() => document.querySelector(".tn-reveal__person").complete &&
    document.querySelector(".tn-reveal__person").naturalWidth > 0);
  await page.waitForFunction(() => document.getElementById("tn-stage-video").readyState >= 3, null, {timeout:45000});
  await check("real H.264 video, local GSAP and one h1", async () => {
    assert.equal(await page.locator("h1").count(),1);
    assert.equal(await page.evaluate(() => gsap.version),"3.15.0");
    assert.equal(await page.evaluate(() => ScrollTrigger.version),"3.15.0");
    const video = await page.locator("#tn-stage-video").evaluate(video => ({
      duration:video.duration, paused:video.paused, transform:getComputedStyle(video).transform,
      h264:video.canPlayType('video/mp4; codecs="avc1.42E01E"')
    }));
    assert.ok(video.duration > 4 && video.duration < 5);
    assert.equal(video.paused,true); assert.equal(video.transform,"none"); assert.ok(video.h264);
  });
  await check("hero height and cursor snap, easing and leave", async () => {
    const box = await page.locator(".tn-reveal").boundingBox();
    assert.ok(Math.abs(box.height - Math.max(560,900-box.y)) < 2);
    await page.mouse.move(box.x + box.width/2, box.y + 150);
    assert.equal(await page.locator(".tn-reveal").evaluate(node => node.classList.contains("is-active")),true);
    const firstX = await page.locator(".tn-reveal").evaluate(node => parseFloat(node.style.getPropertyValue("--mouse-x")));
    assert.ok(Math.abs(firstX-box.width/2)<1);
    await page.waitForTimeout(300);
    await page.screenshot({path:path.join(shots,"desktop-reveal.png")});
    await page.mouse.move(box.width*.7,box.y+180);
    await page.waitForTimeout(250);
    const x = await page.locator(".tn-reveal").evaluate(node => parseFloat(node.style.getPropertyValue("--mouse-x")));
    assert.ok(Math.abs(x-box.width*.7)<10);
    await page.mouse.move(5,5);
    assert.equal(await page.locator(".tn-reveal").evaluate(node => node.classList.contains("is-active")),false);
  });
  await check("changing top advertisement height updates hero and refreshes without duplicate triggers", async () => {
    const initial = await page.evaluate(() => ({top:parseFloat(document.documentElement.style.getPropertyValue("--tn-reveal-top")),count:ScrollTrigger.getAll().length}));
    await page.locator("aside.ad-space").first().evaluate(node => { node.style.height = (node.getBoundingClientRect().height+80)+"px"; });
    await page.waitForTimeout(350);
    const changed = await page.evaluate(() => ({top:parseFloat(document.documentElement.style.getPropertyValue("--tn-reveal-top")),count:ScrollTrigger.getAll().length}));
    assert.ok(Math.abs(changed.top-initial.top-80)<2);
    assert.equal(changed.count,initial.count);
    await page.locator("aside.ad-space").first().evaluate(node => { node.style.height=""; });
    await page.waitForTimeout(350);
  });
  let stage = await page.locator(".tn-stage").boundingBox();
  await check("sticky viewport, forward and reverse scrubbing, and desktop reading interval", async () => {
    await scroll(page,stage.y+(stage.height-900)*.35);
    const first = await page.locator("#tn-stage-video").evaluate(video => video.currentTime);
    assert.ok(first > 1 && first < 2);
    await scroll(page,stage.y+(stage.height-900)*.7);
    const second = await page.locator("#tn-stage-video").evaluate(video => video.currentTime);
    assert.ok(second>first+.8);
    await scroll(page,stage.y+(stage.height-900)*.2);
    const reversed = await page.locator("#tn-stage-video").evaluate(video => video.currentTime);
    assert.ok(reversed<second-.8);
    const viewport = await page.locator(".tn-stage__viewport").boundingBox();
    assert.ok(Math.abs(viewport.y)<2);
    await scroll(page,stage.y+(stage.height-900)*.62);
    for (const card of await page.locator(".tn-promise__card").all())
      assert.ok(Number(await card.evaluate(node => getComputedStyle(node).opacity))>.99);
    await page.screenshot({path:path.join(shots,"desktop-promise.png")});
    await scroll(page,stage.y+(stage.height-900)-5);
    assert.ok(Number(await page.locator(".tn-promise").evaluate(node => getComputedStyle(node).opacity))<.02);
    await scroll(page,stage.y+stage.height+10);
    const released = await page.locator(".tn-stage__viewport").boundingBox();
    assert.ok(released.y < -850);
  });
  await check("six viewport widths have no horizontal overflow or duplicate triggers", async () => {
    for (const width of [320,360,390,768,1024,1440]) {
      await page.setViewportSize({width,height:844});
      await scroll(page,0);
      const dimensions = await page.evaluate(() => ({width:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth, count:ScrollTrigger.getAll().length}));
      assert.ok(dimensions.scroll<=dimensions.width+1, width+"px: "+JSON.stringify(dimensions));
      assert.equal(dimensions.count,3);
    }
  });
  await check("mobile third card fully reachable and touch never enables the lens", async () => {
    await page.setViewportSize({width:390,height:844});
    await scroll(page,0);
    const hero = await page.locator(".tn-reveal").boundingBox();
    await page.locator(".tn-reveal").dispatchEvent("pointerenter",{pointerType:"touch",clientX:100,clientY:hero.y+100});
    assert.equal(await page.locator(".tn-reveal").evaluate(node => node.classList.contains("is-active")),false);
    await page.screenshot({path:path.join(shots,"mobile-reveal.png")});
    const bounds = await page.locator(".tn-stage").boundingBox();
    await scroll(page,bounds.y+844*2.6);
    const third = await page.locator(".tn-promise__card").nth(2).boundingBox();
    assert.ok(third.y>=0 && third.y+third.height<=844,JSON.stringify(third));
    await page.screenshot({path:path.join(shots,"mobile-third-card.png")});
  });
  await check("CTA still reaches news and the existing search works", async () => {
    await scroll(page,0);
    await page.locator(".tn-reveal__cta").click();
    await page.waitForTimeout(1800);
    assert.equal(new URL(page.url()).hash,"#ultimas");
    await page.locator("#search").fill("Notícia de teste");
    assert.equal(await page.locator("#news-grid .news-card").count(),1);
    await page.locator("#search").fill("termo inexistente");
    assert.match(await page.locator("#news-grid").innerText(),/Nenhum resultado/);
    assert.equal(await page.locator("footer [data-cookie-preferences]").count(),1);
    assert.equal(await page.locator("ins.adsbygoogle").count(),2);
  });
  for (const mode of ["reduced-motion","save-data","missing-gsap"]) {
    await check("static fallback: "+mode,async () => {
      const ctx = await context(mode==="reduced-motion" ? {reducedMotion:"reduce",viewport:{width:390,height:844}} : {});
      let videoRequests = 0;
      ctx.on("request",request => { if (request.url().includes(".mp4")) videoRequests++; });
      if (mode==="save-data")
        await ctx.addInitScript(() => Object.defineProperty(navigator,"connection",{value:{saveData:true},configurable:true}));
      if (mode==="missing-gsap") await ctx.route("**/vendor/gsap.min.js",route=>route.abort());
      const fallback = lastPage = await ctx.newPage();
      fallback.on("pageerror",error=>errors.push(error.message));
      await fallback.goto(base,{waitUntil:"domcontentloaded"});
      await fallback.waitForTimeout(350);
      const state = await fallback.evaluate(() => ({motion:document.documentElement.classList.contains("tn-motion"),
        src:document.getElementById("tn-stage-video").getAttribute("src"),
        poster:document.getElementById("tn-stage-video").poster,
        sticky:getComputedStyle(document.querySelector(".tn-stage__viewport")).position,
        hidden:[...document.querySelectorAll(".tn-promise__card")].some(node=>getComputedStyle(node).visibility==="hidden"),
        width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert.equal(state.motion,false); assert.equal(state.src,null); assert.ok(state.poster);
      assert.notEqual(state.sticky,"sticky"); assert.equal(state.hidden,false);
      assert.ok(state.scroll<=state.width+1); assert.equal(videoRequests,0);
      if (mode==="reduced-motion") await fallback.screenshot({path:path.join(shots,"mobile-static.png"),fullPage:true});
      await ctx.close();
    });
  }
  await check("article URLs skip motion and preserve the existing article flow", async () => {
    for (const url of ["/?noticia=teste-motion","/?slug=teste-motion","/noticia.html?slug=teste-motion"]) {
      const ctx = await context();
      let videoRequests=0; ctx.on("request",request=>{ if(request.url().includes(".mp4"))videoRequests++; });
      const story=lastPage=await ctx.newPage(); story.on("pageerror",error=>errors.push(error.message));
      await story.goto(base+url,{waitUntil:"domcontentloaded"});
      await story.waitForFunction(()=>document.querySelector("h1")?.textContent==="Notícia de teste");
      assert.equal(await story.locator(".tn-reveal,.tn-stage").count(),0);
      assert.equal(await story.evaluate(()=>document.documentElement.classList.contains("tn-motion")),false);
      assert.equal(videoRequests,0); await ctx.close();
    }
  });
  assert.deepEqual(errors,[]);
  console.log("PASS no JavaScript errors or CSP violations");
  console.log("Screenshots "+shots);
})().catch(async error=>{
  console.error(error.stack);
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({path:path.join(shots,"failure.png")}).catch(()=>{});
  process.exitCode=1;
}).finally(async ()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
});

