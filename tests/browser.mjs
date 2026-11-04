// What a visitor does on the page, in headless Chrome against a folder served over loopback.
//   node tests/browser.mjs [folder] [--port 9620] [--limit 180]
// Prints PASS or FAIL per check and exits 1 on a failure. The run stops itself after --limit seconds.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launch } from "./cdp.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : dflt; };
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
const dir = resolve(positional[0] || ".");
const html = readFileSync(join(dir, "index.html"), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const missing = [];
const server = createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, "http://x").pathname);
  const f = join(dir, p === "/" ? "index.html" : p);
  if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) { missing.push(p); r.writeHead(404); r.end("not found"); return; }
  r.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); r.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let b = null, failed = 0;
const done = (code) => { try { server.close(); } catch {} Promise.resolve(b && b.close()).finally(() => process.exit(code)); };
setTimeout(() => { console.log("FAIL the run did not finish in", arg("limit", 180), "seconds"); done(1); }, Number(arg("limit", 180)) * 1000).unref();
b = await launch({ port: Number(arg("port", 9620)) });
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log(cond ? "PASS" : "FAIL", name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// every scene ends on the same words as the page holds without a script
const finalNotes = {};
for (const m of html.matchAll(/<article class="tech[^"]*"[^>]*data-tech="(\w+)"[\s\S]*?<p class="shot-note" data-note>([^<]*)</g)) finalNotes[m[1]] = m[2].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").trim();

async function open(opts = {}) {
  const { w = 1280, h = 900, reduced = "", nojs = false, fast = 0, stored = "", wait = 700 } = opts;
  const p = await b.newPage();
  await p.viewport(w, h, 1, w < 700);
  await p.media({ reduced });
  if (nojs) await p.cmd("Emulation.setScriptExecutionDisabled", { value: true });
  if (stored) await p.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("theme","${stored}")}catch(e){}` });
  // run the scenes faster: the timers of the page wait a sixth of their time
  if (fast) await p.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `(function(){var st=window.setTimeout;window.setTimeout=function(f,d){return st(f,(d||0)/${fast})}})()` });
  await p.goto(base, wait);
  return p;
}
const bg = (p) => p.eval(`getComputedStyle(document.body).backgroundColor`);

// 1. it loads cleanly
for (const w of [1280, 390]) {
  const p = await open({ w });
  const errors = p.logs.filter((l) => /^(EXCEPTION|error)/.test(l));
  ok(`loads with no script error at ${w} px`, errors.length === 0, errors[0] || "");
  await p.close();
}
ok("the browser never asked for a file the page does not have (logo, fonts)", missing.length === 0, missing.join(" "));

// 2. the theme switch
{
  let p = await open();
  const light = await bg(p);
  await p.eval(`document.querySelector("[data-theme-toggle]").click()`); await sleep(400);
  const dark = await bg(p);
  await p.goto(base, 700);
  const kept = await bg(p);
  ok("the theme switch turns the page dark and the choice is kept after a reload", dark !== light && kept === dark, `${light} -> ${dark}, reloaded ${kept}`);
  await p.eval(`document.querySelector("[data-theme-toggle]").click()`); await sleep(400);
  await p.goto(base, 700);
  ok("switching back to light is kept too", (await bg(p)) === light);
  await p.close();
  p = await open({ stored: "dark" });
  ok("a visitor who chose dark before gets dark", (await bg(p)) === dark);
  await p.close();
}

// 3. the try-an-input box tells the truth about the program shown
{
  const p = await open();
  // the program: four characters, starting A7, then two digits, at most 40; row 0 is missing from the table, so 00 crashes
  const expected = (s) => { if (s.length !== 4) return [1, "bad"]; if (!s.startsWith("A7")) return [2, "bad"]; if (!/^\d\d$/.test(s.slice(2))) return [3, "bad"]; const n = Number(s.slice(2)); if (n > 40) return [4, "bad"]; return n === 0 ? [5, "bad"] : [0, "good"]; };
  const cases = ["A712", "A701", "A740", "A700", "A741", "A799", "A7X1", "A71", "HH12", "a712", "A7123", ""];
  const bad = [];
  for (const v of cases) {
    await p.eval(`(function(){var i=document.getElementById("code-input"); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input",{bubbles:true})); i.form.requestSubmit()})()`);
    await sleep(900);
    const got = await p.eval(`({cls: document.getElementById("result-msg").className, strip: [...document.querySelectorAll("#run-strip li")].map(function(l){return l.className})})`);
    const [stopAt, cls] = expected(v);
    if (v === "") continue;
    const failedAt = got.strip.findIndex((c) => /fail/.test(c)) + 1;
    const verdict = got.cls.includes("good") ? "good" : "bad";
    if (verdict !== cls || (stopAt && failedAt !== stopAt) || (!stopAt && failedAt !== 0)) bad.push(`${v}: ${verdict}, stopped at ${failedAt}, expected ${cls} at ${stopAt}`);
  }
  ok("each input gets the right verdict and stops at the right check", bad.length === 0, bad.slice(0, 3).join(" | "));
  await p.eval(`document.getElementById("showme-btn").click()`); await sleep(2500);
  const shown = await p.eval(`({v: document.getElementById("code-input").value, cls: document.getElementById("result-msg").className})`);
  ok("Show me types an input that really crashes the program", expected(shown.v)[0] === 5 && shown.cls.includes("bad"), JSON.stringify(shown));
  const before = await p.eval(`document.getElementById("code-view").textContent`);
  await p.eval(`document.querySelector('[data-target="python"]').click()`); await sleep(500);
  const after = await p.eval(`({code: document.getElementById("code-view").textContent, pressed: [...document.querySelectorAll("[data-target]")].filter(function(x){return x.getAttribute("aria-pressed")==="true"}).map(function(x){return x.dataset.target})})`);
  ok("choosing a language shows that language's program and marks only that choice", after.code !== before && /def |lookup/.test(after.code) && after.pressed.join() === "python", after.pressed.join());
  await p.close();
}

// 4. the tabs show one scene each
{
  const p = await open();
  const n = await p.eval(`({tabs: document.querySelectorAll("label.tab").length, scenes: document.querySelectorAll("article.tech").length})`);
  const bad = [];
  for (let i = 0; i < n.tabs; i++) {
    await p.eval(`document.querySelectorAll("label.tab")[${i}].click()`); await sleep(250);
    const s = await p.eval(`({shown: [...document.querySelectorAll("article.tech")].map(function(a, j){return [j, a.getBoundingClientRect().height > 0]}).filter(function(x){return x[1]}).map(function(x){return x[0]})})`);
    if (s.shown.join() !== String(i)) bad.push(`tab ${i} shows scenes ${s.shown}`);
  }
  ok("there is a tab for every scene and each shows its own scene alone", n.tabs === n.scenes && n.tabs >= 7 && bad.length === 0, `${n.tabs} tabs, ${n.scenes} scenes ${bad.join("; ")}`);
  await p.close();
}

// 5. every scene plays to its end; Play again runs it again
{
  const p = await open({ fast: 6 });
  const n = await p.eval(`document.querySelectorAll("label.tab").length`);
  const state = `(function(){var a=document.querySelector("article.tech.shown"); return {tech: a.dataset.tech, note: a.querySelector("[data-note]").textContent.trim(), lit: a.querySelectorAll(".ln.on").length, crash: a.querySelectorAll(".ln.bad").length, moving: a.getAnimations({subtree:true}).filter(function(x){return x.playState==="running" && x.effect.getComputedTiming().iterations===Infinity}).length}})()`;
  const stuck = [];
  for (let i = 0; i < n; i++) {
    await p.eval(`document.querySelectorAll("label.tab")[${i}].click()`);
    let s, end = false;
    for (let k = 0; k < 40 && !end; k++) {
      await sleep(250); s = await p.eval(state);
      end = s.tech === "custom" ? true : (s.note === finalNotes[s.tech] && s.crash >= 1 && s.lit > 0);
    }
    if (!end || s.moving) stuck.push(s.tech);
  }
  ok("every scene reaches its last picture and stops", stuck.length === 0, "stuck: " + stuck.join(","));
  await p.eval(`document.querySelectorAll("label.tab")[0].click()`);
  for (let k = 0; k < 40; k++) { await sleep(250); const s = await p.eval(state); if (s.note === finalNotes[s.tech] && s.crash >= 1) break; }      // let it finish first
  await p.eval(`document.querySelector("article.tech.shown [data-replay]").click()`); await sleep(150);
  const restarted = await p.eval(state);
  let again = false;
  for (let k = 0; k < 40 && !again; k++) { await sleep(250); const s = await p.eval(state); again = s.note === finalNotes[s.tech] && s.crash >= 1; }
  ok("Play again starts the scene over and it reaches the end again", restarted.note !== finalNotes[restarted.tech] && again, restarted.note.slice(0, 40));
  await p.close();
}

// 6. with reduced motion a scene is complete at once
{
  const p = await open({ reduced: "reduce" });
  const bad = [];
  const n = await p.eval(`document.querySelectorAll("label.tab").length`);
  for (let i = 0; i < n - 1; i++) {
    await p.eval(`document.querySelectorAll("label.tab")[${i}].click()`); await sleep(500);
    const s = await p.eval(`(function(){var a=document.querySelector("article.tech.shown"); return {tech: a.dataset.tech, note: a.querySelector("[data-note]").textContent.trim(), crash: a.querySelectorAll(".ln.bad").length}})()`);
    if (s.note !== finalNotes[s.tech] || s.crash < 1) bad.push(s.tech);
  }
  ok("with reduced motion every scene shows its last picture at once", bad.length === 0, bad.join(","));
  await p.close();
}

// 7. nothing is cut off or wider than the screen
{
  const bad = [];
  for (const w of [360, 390, 768, 1100, 1440]) {
    const p = await open({ w, h: 900, wait: 600 });
    const n = await p.eval(`document.querySelectorAll("label.tab").length`);
    for (const i of [0, 3, n - 1]) {
      await p.eval(`document.querySelectorAll("label.tab")[${i}].click()`); await sleep(400);
      const m = await p.eval(`(function(){var d=document.documentElement, a=document.querySelector("article.tech.shown"), s=a.querySelector(".shot").getBoundingClientRect(); return {over: d.scrollWidth - d.clientWidth, right: s.right, left: s.left, vw: d.clientWidth}})()`);
      if (m.over > 1 || m.right > m.vw + 1 || m.left < -1) bad.push(`${w}px tab ${i}: over ${m.over}, card ${m.left | 0}..${m.right | 0}`);
    }
    await p.close();
  }
  ok("no width scrolls sideways and every card fits its screen", bad.length === 0, bad.slice(0, 3).join(" | "));
}

// 8. without scripts the techniques are all on the page
{
  const p = await open({ nojs: true, wait: 500 });
  const s = await p.eval(`({scenes: [...document.querySelectorAll("article.tech")].filter(function(a){return a.getBoundingClientRect().height>0}).length, notes: [...document.querySelectorAll("article.tech [data-note]")].filter(function(n){return n.textContent.trim().length>10}).length})`);
  const total = Object.keys(finalNotes).length;
  ok("with scripts off every technique is shown, written out", s.scenes >= 8 && s.notes >= total, JSON.stringify(s));
  await p.close();
}
// 9. text can be read in both themes
{
  const probe = `(function(){
    function rgb(s){var m=s.match(/[\\d.]+/g).map(Number); return {r:m[0],g:m[1],b:m[2],a:m.length>3?m[3]:1}}
    function lum(c){return [c.r,c.g,c.b].map(function(v){v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}).reduce(function(s,v,i){return s+v*[0.2126,0.7152,0.0722][i]},0)}
    function ground(e){while(e){var c=rgb(getComputedStyle(e).backgroundColor); if(c.a>0.9) return c; e=e.parentElement} return {r:255,g:255,b:255,a:1}}
    var out=[]; [["h1",3],[".tech-text .lead",4.5],[".mast-links a",4.5],[".try-card label, #try-hint",4.5],["#result-msg",4.5],["button.replay",4.5],[".tab",4.5]].forEach(function(q){
      var e=document.querySelector(q[0]); if(!e||e.getBoundingClientRect().width===0) return;
      var f=rgb(getComputedStyle(e).color), g=ground(e), a=lum(f)+0.05, b2=lum(g)+0.05, c=Math.max(a,b2)/Math.min(a,b2);
      if(c<q[1]) out.push(q[0]+" "+c.toFixed(1));
    }); return out})()`;
  const bad = [];
  for (const mode of ["light", "dark"]) {
    const p = await open({ stored: mode });
    await p.eval(`document.querySelectorAll("label.tab")[0].click()`); await sleep(300);
    bad.push(...(await p.eval(probe)).map((x) => mode + ": " + x));
    await p.close();
  }
  ok("text has enough contrast in the light and the dark theme", bad.length === 0, bad.join(" | "));
}
console.log(failed ? `${failed} checks failed` : "all checks passed");
done(failed ? 1 : 0);
