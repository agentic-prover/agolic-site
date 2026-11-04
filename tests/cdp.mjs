// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Agent Software Testing authors
// Minimal Chrome DevTools Protocol driver (node >= 22, no dependencies) used by the checks of the site:
// full-page screenshots, viewport and colour-scheme emulation, pointer and keyboard input, timing.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";   // set CHROME to the browser binary on your machine
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, fileAccess = true, gpu = false } = {}) {
  // One browser profile folder per port in the system temp folder; the next run reuses it.
  const dir = join(tmpdir(), "agolic-tests-chrome", String(port));
  mkdirSync(dir, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", ...(gpu ? [] : ["--disable-gpu"]), "--hide-scrollbars", `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", ...(fileAccess ? ["--allow-file-access-from-files"] : []), "about:blank",
  ], { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 100; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); }
  }
  if (!ver) throw new Error("Chrome did not start");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  async function newPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const cmd = (m, p) => send(m, p, sessionId);
    await cmd("Page.enable"); await cmd("Runtime.enable");
    const logs = [];
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.consoleAPICalled") logs.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
      if (msg.method === "Runtime.exceptionThrown") logs.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    });
    const page = {
      logs,
      cmd,
      // call fn(params) for every protocol event of this page named `method` (for example "Tracing.dataCollected"); returns a function that stops listening
      on(method, fn) {
        const l = (msg) => { if (msg.sessionId === sessionId && msg.method === method) fn(msg.params); };
        listeners.push(l);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      async viewport(width, height, dpr = 1, mobile = false) {
        await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
      },
      async media({ scheme, reduced, forced } = {}) {
        const features = [];
        if (scheme) features.push({ name: "prefers-color-scheme", value: scheme });
        if (reduced) features.push({ name: "prefers-reduced-motion", value: reduced });
        if (forced) features.push({ name: "forced-colors", value: forced });      // "active" emulates Windows high contrast
        await cmd("Emulation.setEmulatedMedia", { features });
        // The site chooses its theme with data-theme, so a test's scheme stands for the visitor's choice, on this page and on pages opened later.
        if (scheme) {
          const set = scheme === "dark" ? 'document.documentElement.setAttribute("data-theme","dark")' : 'document.documentElement.removeAttribute("data-theme")';
          await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("theme","${scheme}")}catch(e){}` });
          await cmd("Runtime.evaluate", { expression: `try{localStorage.setItem("theme","${scheme}")}catch(e){};if(document.documentElement){${set};window.dispatchEvent(new Event("themechange"))}` });
        }
      },
      async goto(url, wait = 900) {
        await cmd("Page.navigate", { url });
        await sleep(wait);
      },
      async eval(expr) {
        const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async shot(path, { full = false, clip } = {}) {
        const { data } = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, Buffer.from(data, "base64"));
      },
      async move(x, y) { await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); },
      async click(x, y) {
        await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      },
      async key(key, { modifiers = 0, code } = {}) {
        const keyCodes = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, PageUp: 33, PageDown: 34, Escape: 27, Tab: 9, Enter: 13 };
        const vk = keyCodes[key];
        await cmd("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
        await cmd("Input.dispatchKeyEvent", { type: "keyUp", key, code: code || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      },
      async close() { await send("Target.closeTarget", { targetId }); },
    };
    return page;
  }
  async function close() {
    try { ws.close(); } catch {}
    proc.kill("SIGTERM");
    await sleep(300);
  }
  return { newPage, close, sleep };
}
