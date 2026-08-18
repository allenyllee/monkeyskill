import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCriterionIds } from "../src/lib/llm.js";
import { validateDeveloperConformance } from "../src/lib/test-spec.js";

const args = process.argv.slice(2);
const sessionId = args.find(value => !value.startsWith("--"));
const headed = args.includes("--headed");
const requestedBrowser = optionValue(args, "--browser");
const requestedPort = Number(optionValue(args, "--port") || 0);
const packageDir = path.resolve(optionValue(args, "--package-dir") || "../monkeyskill-store/skills/restore-right-click");

async function main() {
  if (!sessionId) {
    throw new Error("Usage: node scripts/run-real-browser-conformance.mjs <builder-session-id> [--headed] [--browser <path>] [--port <port>]");
  }
  if (requestedPort && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error("Invalid HTTP port.");
  }
const candidate = await readBuilderCandidate(sessionId);
const candidateCode = candidate.modes?.absolute?.js;
const candidateStandardCode = candidate.modes?.standard?.js;
if (typeof candidateCode !== "string") throw new Error("Builder completion has no Absolute JavaScript.");
if (typeof candidateStandardCode !== "string") throw new Error("Builder completion has no Standard JavaScript.");

const referenceCode = String.raw`(() => {
  const pointerTargets = "canvas,img,input,textarea,select,button,video,svg,[contenteditable]:not([contenteditable='false'])";
  const emptyOverlay = element => !element.matches(pointerTargets + ",a,label,option")
    && !element.textContent.trim()
    && !element.querySelector(pointerTargets);
  const visualBackground = element => {
    const style = getComputedStyle(element);
    return style.backgroundImage !== "none"
      || !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor);
  };
  const repair = root => {
    const all = [...root.querySelectorAll("body *")];
    const targets = all.filter(element => element.matches(pointerTargets) || visualBackground(element));
    const overlays = all.filter(emptyOverlay);
    for (const target of targets) {
      if (getComputedStyle(target).pointerEvents === "none") {
        target.style.setProperty("pointer-events", "auto", "important");
      }
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || hit === target || target.contains(hit) || hit.contains(target) || !overlays.includes(hit)) continue;
      const cover = hit.getBoundingClientRect();
      if (rect.right > cover.left && rect.left < cover.right && rect.bottom > cover.top && rect.top < cover.bottom) {
        hit.style.setProperty("pointer-events", "none", "important");
      }
    }
  };
  const schedule = () => setTimeout(() => repair(document), 0);
  const installSelectionRepair = () => {
    const style = document.createElement("style");
    style.textContent = "[unselectable],.blocked-selection{user-select:text!important;-webkit-user-select:text!important}";
    (document.head || document.documentElement).append(style);
    for (const element of document.querySelectorAll("[unselectable]")) element.removeAttribute("unselectable");
  };
  const protectSelectionEvent = event => {
    if (event.type === "mousedown" && (event.button !== 0 || event.target.closest("input,textarea,button,select,a,[contenteditable]"))) return;
    if (event.type === "selectstart" && event.target.closest("input,textarea,[contenteditable]")) return;
    event.stopImmediatePropagation();
  };
  addEventListener("mousedown", protectSelectionEvent, true);
  addEventListener("selectstart", protectSelectionEvent, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { installSelectionRepair(); schedule(); }, { once: true });
  else { installSelectionRepair(); schedule(); }
})();`;

const developerConformance = await readDeveloperConformance(packageDir);
const server = await startServer(requestedPort);
const profile = await mkdtemp(path.join(os.tmpdir(), "monkeyskill-real-browser-"));
const executable = findBrowserExecutable(requestedBrowser);
let browserProcess;
try {
  browserProcess = spawn(executable, [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "--password-store=basic",
    "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    "--window-size=1280,900",
    ...(headed ? [] : ["--headless=new"]),
    "about:blank"
  ], { stdio: "ignore", windowsHide: !headed });

  const debugPort = await waitForDevToolsPort(profile, browserProcess);
  const matrix = [];
  for (const variant of [
    { name: "baseline", code: "" },
    { name: "candidate-standard", code: candidateStandardCode },
    { name: "candidate-absolute", code: candidateCode },
    { name: "reference", code: referenceCode }
  ]) {
    matrix.push(await runVariant({ debugPort, origin: server.origin, ...variant }));
  }
  const trustedDsl = await runDeveloperConformance({
    debugPort,
    origin: server.origin,
    testSpec: developerConformance,
    build: candidate
  });
  const report = {
    schemaVersion: 1,
    sessionId,
    headed,
    browser: executable,
    candidateHash: await sha256(JSON.stringify(candidate.modes)),
    generatedAt: new Date().toISOString(),
    matrix,
    developerConformance: trustedDsl,
    selfCheck: {
      baselineBlocked: matrix.find(entry => entry.variant === "baseline").overlay.passed === 0,
      baselineSelectionBlocked: matrix.find(entry => entry.variant === "baseline").selection.dragPass === false,
      referencePassed: matrix.find(entry => entry.variant === "reference").overlay.passed === matrix.find(entry => entry.variant === "reference").overlay.total,
      referenceSelectionPassed: ["dragPass", "dismissalPass", "reselectionPass"].every(key => matrix.find(entry => entry.variant === "reference").selection[key]),
      developerInfrastructureReady: trustedDsl.inconclusive === 0,
      realViewport: matrix.every(entry => entry.environment.innerWidth > 0 && entry.environment.innerHeight > 0),
      rendered: matrix.every(entry => entry.environment.visibilityState === "visible")
    }
  };
  report.ok = Object.values(report.selfCheck).every(Boolean);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
} finally {
  await server.close();
  if (browserProcess && browserProcess.exitCode == null) {
    browserProcess.kill();
    await Promise.race([
      new Promise(resolve => browserProcess.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
  }
  const resolvedProfile = path.resolve(profile);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`) || !path.basename(resolvedProfile).startsWith("monkeyskill-real-browser-")) {
    throw new Error(`Refusing to remove unexpected profile path: ${resolvedProfile}`);
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
}
}

export async function runTrustedDeveloperConformance({ testSpec, build, browserPath, headed = false }) {
  if (!testSpec || !Array.isArray(testSpec.tests)) throw new Error("Real-browser conformance requires a validated TestSpec.");
  if (!build?.modes || typeof build.modes !== "object") throw new Error("Real-browser conformance requires candidate modes.");
  const missingMode = testSpec.tests.find(test => !build.modes[test.mode]);
  if (missingMode) throw new Error(`Real-browser conformance test ${missingMode.id || "(unknown)"} references missing mode ${missingMode.mode || "(unknown)"}.`);
  const server = await startServer(0);
  const profile = await mkdtemp(path.join(os.tmpdir(), "monkeyskill-real-browser-"));
  const executable = findBrowserExecutable(browserPath);
  let browserProcess;
  try {
    browserProcess = spawn(executable, [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--password-store=basic",
      "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--window-size=1280,900",
      ...(headed ? [] : ["--headless=new"]),
      "about:blank"
    ], { stdio: "ignore", windowsHide: !headed });
    const debugPort = await waitForDevToolsPort(profile, browserProcess);
    return await runDeveloperConformance({ debugPort, origin: server.origin, testSpec, build });
  } finally {
    await server.close();
    await stopBrowserAndRemoveProfile(browserProcess, profile);
  }
}

async function stopBrowserAndRemoveProfile(browserProcess, profile) {
  if (browserProcess && browserProcess.exitCode == null) {
    browserProcess.kill();
    await Promise.race([
      new Promise(resolve => browserProcess.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
  }
  const resolvedProfile = path.resolve(profile);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`) || !path.basename(resolvedProfile).startsWith("monkeyskill-real-browser-")) {
    throw new Error(`Refusing to remove unexpected profile path: ${resolvedProfile}`);
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readBuilderCandidate(id) {
  const bootstrap = JSON.parse(await readFile(".tmp-clean-agent-bootstrap.json", "utf8"));
  const response = await fetch(`http://127.0.0.1:8788/sessions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${bootstrap.token}` }
  });
  if (!response.ok) throw new Error(`Session fetch failed: HTTP ${response.status}`);
  const session = await response.json();
  const lastAssistant = [...session.turns].reverse().find(turn => turn.role === "assistant");
  if (!lastAssistant || typeof lastAssistant.content !== "string") throw new Error("Session has no Builder completion.");
  return JSON.parse(lastAssistant.content);
}

async function readDeveloperConformance(directory) {
  const [rawConformance, rawSkill, instructions] = await Promise.all([
    readFile(path.join(directory, "conformance.json"), "utf8"),
    readFile(path.join(directory, "skill.json"), "utf8"),
    readFile(path.join(directory, "SKILL.md"), "utf8")
  ]);
  const skill = JSON.parse(rawSkill);
  const criteria = extractCriterionIds(instructions);
  return validateDeveloperConformance(JSON.parse(rawConformance), skill, criteria);
}

function findBrowserExecutable(requested) {
  const candidates = [
    requested,
    process.env.MONKEYSKILL_BROWSER,
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ].filter(Boolean);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error("No supported Chromium browser found. Set MONKEYSKILL_BROWSER or pass --browser.");
  return executable;
}

async function waitForDevToolsPort(profileDir, child) {
  const file = path.join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Browser exited before CDP became ready (${child.exitCode}).`);
    try {
      const [port] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
      if (/^\d+$/.test(port)) return Number(port);
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the browser CDP endpoint.");
}

async function runVariant({ debugPort, origin, name, code }) {
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!targetResponse.ok) throw new Error(`Could not create CDP target: HTTP ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  const networkViolations = [];
  client.on("Fetch.requestPaused", event => {
    const url = event.request.url;
    const allowed = url.startsWith(origin) || url.startsWith("data:") || url === "about:blank";
    if (!allowed) networkViolations.push(url.slice(0, 200));
    void client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
      ? { requestId: event.requestId }
      : { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
  });
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: instrumentationCode() });
    if (code) await client.send("Page.addScriptToEvaluateOnNewDocument", { source: code });
    await client.send("Page.bringToFront");
    const loaded = onceEvent(client, "Page.loadEventFired", 10000);
    await client.send("Page.navigate", { url: `${origin}/fixture?variant=${encodeURIComponent(name)}` });
    await loaded;
    await waitForExpression(client, "window.__diagnosticReady === true", 10000);
    await new Promise(resolve => setTimeout(resolve, 1900));

    const environment = await evaluate(client, `({
      innerWidth,
      innerHeight,
      devicePixelRatio,
      visibilityState: document.visibilityState,
      userAgent: navigator.userAgent
    })`);
    const overlayCases = await evaluate(client, `[...document.querySelectorAll('[data-overlay-case]')].map(section => {
      const target = section.querySelector('.overlay-target');
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { id: section.dataset.overlayCase, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        hitBeforeContextMenu: hit?.dataset?.role || hit?.tagName || null };
    })`);
    const overlayResults = [];
    for (const overlayCase of overlayCases) {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: overlayCase.x, y: overlayCase.y });
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: overlayCase.x, y: overlayCase.y, button: "right", buttons: 2, clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: overlayCase.x, y: overlayCase.y, button: "right", buttons: 0, clickCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 30));
      const observed = await evaluate(client, `window.__contextMenus.at(-1) || null`);
      overlayResults.push({
        id: overlayCase.id,
        pass: observed?.caseId === overlayCase.id && observed?.role === "target" && observed?.defaultPrevented === false,
        hit: overlayCase.hitBeforeContextMenu,
        contextMenuTarget: observed?.role || null,
        defaultPrevented: observed?.defaultPrevented ?? null
      });
    }

    const selection = await runSelectionWorkflow(client);
    return {
      variant: name,
      environment,
      overlay: {
        passed: overlayResults.filter(result => result.pass).length,
        total: overlayResults.length,
        results: overlayResults
      },
      selection,
      networkViolations
    };
  } finally {
    client.close();
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`).catch(() => undefined);
  }
}

async function runDeveloperConformance({ debugPort, origin, testSpec, build }) {
  const capabilityNames = [...new Set(testSpec.tests.flatMap(requiredCapabilities))];
  const capabilities = {};
  for (const capability of capabilityNames) {
    capabilities[capability] = await runSandboxPayload({ debugPort, origin, payload: { capability } });
  }
  const results = [];
  for (const test of testSpec.tests) {
    const unsupported = requiredCapabilities(test).find(capability => !capabilities[capability]?.ok);
    if (unsupported) {
      results.push({
        id: test.id,
        criterion: test.criterion,
        mode: test.mode,
        ok: false,
        inconclusive: true,
        capability: unsupported,
        category: unsupported === "hit-test" ? "visibility-state" : "dom-state"
      });
      continue;
    }
    const result = await runSandboxPayload({
      debugPort,
      origin,
      payload: { test, artifact: build.modes[test.mode] }
    });
    results.push({ id: test.id, criterion: test.criterion, mode: test.mode, ...result });
  }
  return {
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok && !result.inconclusive).length,
    inconclusive: results.filter(result => result.inconclusive).length,
    total: results.length,
    capabilities,
    results
  };
}

function requiredCapabilities(test) {
  if (test.kind !== "behavior") return [];
  const names = [];
  if (test.assertions.some(assertion => assertion.type === "active-element")) names.push("focus");
  if (test.assertions.some(assertion => assertion.type === "hit-test")) names.push("hit-test");
  if (test.steps.some(step => step.action === "drag-select-text")) names.push("drag-select-text");
  if (test.steps.some(step => step.action === "copy-shortcut")) names.push("copy-shortcut");
  return names;
}

async function runSandboxPayload({ debugPort, origin, payload }) {
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!targetResponse.ok) throw new Error(`Could not create sandbox CDP target: HTTP ${targetResponse.status}`);
  const target = await targetResponse.json();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  const networkViolations = [];
  client.on("Fetch.requestPaused", event => {
    const url = event.request.url;
    const allowed = url.startsWith(origin) || url.startsWith("data:") || url === "about:blank";
    if (!allowed) networkViolations.push(url.slice(0, 200));
    void client.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed
      ? { requestId: event.requestId }
      : { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
  });
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: String.raw`(() => {
      Object.defineProperty(window, "__monkeyskillCdp", { value: { nonce: null, result: null } });
      addEventListener("message", event => {
        if (event.data?.type === "monkeyskill-sandbox-ready") window.__monkeyskillCdp.nonce = event.data.nonce;
        if (event.data?.type === "monkeyskill-test-result") window.__monkeyskillCdp.result = event.data.result;
      });
    })();` });
    await client.send("Page.bringToFront");
    const loaded = onceEvent(client, "Page.loadEventFired", 10000);
    await client.send("Page.navigate", { url: `${origin}/sandbox.html` });
    await loaded;
    await waitForExpression(client, "Boolean(window.__monkeyskillCdp?.nonce)", 5000);
    await client.send("Runtime.evaluate", {
      expression: `window.postMessage(${JSON.stringify({ type: "monkeyskill-run-test", ...payload }) .replace(/"nonce":null,?/, "") .replace(/}\s*$/, `,nonce:window.__monkeyskillCdp.nonce}`)}, "*")`
    });
    await waitForExpression(client, "window.__monkeyskillCdp.result !== null", 10000);
    const result = await evaluate(client, "window.__monkeyskillCdp.result");
    if (networkViolations.length > 0) {
      return { ok: false, category: "policy-state", diagnostic: { blockedNetwork: networkViolations } };
    }
    return result;
  } finally {
    client.close();
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`).catch(() => undefined);
  }
}

async function runSelectionWorkflow(client) {
  const first = await elementRect(client, "#selection-target");
  await drag(client, first.left + 10, first.top + first.height / 2, first.right - 10, first.top + first.height / 2);
  await new Promise(resolve => setTimeout(resolve, 500));
  const afterDrag = await selectionState(client);
  const dismiss = await elementRect(client, "#dismiss-area");
  await click(client, dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2);
  await new Promise(resolve => setTimeout(resolve, 100));
  const afterDismiss = await selectionState(client);
  const next = await elementRect(client, "#selection-next");
  await drag(client, next.left + 10, next.top + next.height / 2, next.right - 10, next.top + next.height / 2);
  await new Promise(resolve => setTimeout(resolve, 200));
  const afterReselect = await selectionState(client);
  return {
    dragPass: !afterDrag.collapsed && afterDrag.text.length > 0,
    dismissalPass: afterDismiss.collapsed,
    reselectionPass: !afterReselect.collapsed && afterReselect.text.length > 0,
    afterDrag,
    afterDismiss,
    afterReselect,
    diagnostic: await evaluate(client, `({ blockerCalls: window.__selectionBlockerCalls, userSelect: getComputedStyle(document.querySelector('#selection-target')).userSelect, unselectable: document.querySelector('#selection-target').getAttribute('unselectable') })`)
  };
}

async function elementRect(client, selector) {
  return evaluate(client, `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return ({ left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height }); })()`);
}

async function selectionState(client) {
  return evaluate(client, `(() => { const selection = getSelection(); return { collapsed: selection?.isCollapsed ?? true, text: selection?.toString() || "", rangeCount: selection?.rangeCount || 0 }; })()`);
}

async function click(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function drag(client, startX, startY, endX, endY) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y: startY });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 12; step += 1) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: startX + ((endX - startX) * step / 12),
      y: startY + ((endY - startY) * step / 12),
      button: "left",
      buttons: 1
    });
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: endX, y: endY, button: "left", buttons: 0, clickCount: 1 });
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "CDP evaluation failed.");
  if (!response.result) throw new Error(`CDP evaluation returned no result for: ${expression.slice(0, 120)}`);
  return response.result.value;
}

async function waitForExpression(client, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function onceEvent(client, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for CDP event ${method}.`));
    }, timeoutMs);
    const unsubscribe = client.on(method, params => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(params);
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closing = false;
    socket.addEventListener("message", event => this.receive(event.data));
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        if (this.closing) pending.resolve({});
        else pending.reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  receive(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  close() {
    this.closing = true;
    this.socket.close();
  }
}

async function startServer(port) {
  const [sandboxHtml, sandboxJavaScript] = await Promise.all([
    readFile(new URL("../src/validation/sandbox.html", import.meta.url), "utf8"),
    readFile(new URL("../src/validation/sandbox.js", import.meta.url), "utf8")
  ]);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/sandbox.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(sandboxHtml);
      return;
    }
    if (url.pathname === "/sandbox.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      response.end(sandboxJavaScript);
      return;
    }
    if (url.pathname !== "/fixture") {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"
    });
    response.end(fixturePage());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port || 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

function fixturePage() {
  const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2314283c'/%3E%3C/svg%3E";
  const cases = [
    ["canvas", '<canvas class="overlay-target" data-role="target" width="240" height="120"></canvas>'],
    ["image", `<img class="overlay-target" data-role="target" src="${image}" alt="image target">`],
    ["input", '<input class="overlay-target" data-role="target" value="input target">'],
    ["background", '<div class="overlay-target background-target" data-role="target">background target</div>']
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <style>
  body{margin:20px;font:16px/1.5 system-ui,sans-serif;color:#17211b;background:#f4f7f3}.grid{display:grid;grid-template-columns:repeat(2,280px);gap:18px}.case{padding:10px;background:#fff;border:1px solid #ccd6ce}.wrap{position:relative;width:240px;height:120px;margin-top:6px}.overlay-target,.blocking-overlay{position:absolute;left:0;top:0;width:240px;height:120px;box-sizing:border-box}.overlay-target{pointer-events:none;background:#14283c;color:white}.background-target{background-image:linear-gradient(135deg,#14283c,#37667e)}.blocking-overlay{z-index:10;pointer-events:auto;background:transparent}
  .selection{margin-top:24px;width:560px}.selection p,.selection div{padding:10px;background:white;border:1px solid #ccd6ce}.blocked-selection{user-select:none}.dismiss{height:34px}.next{user-select:text}
  </style></head><body><h1>MonkeySkill real-browser conformance fixture</h1><div class="grid">
  ${cases.map(([id, target]) => `<section class="case" data-overlay-case="${id}"><b>${id}</b><div class="wrap">${target}<div class="blocking-overlay" data-role="overlay"></div></div></section>`).join("")}
  </div><section class="selection"><p id="selection-target" class="blocked-selection" unselectable="on" onmousedown="window.__selectionBlockerCalls += 1; return false">Select this first real-browser passage from left to right.</p><div id="dismiss-area" class="dismiss">Click this ordinary page area to dismiss the old selection.</div><p id="selection-next" class="next">Then select this different passage to prove interaction resumes.</p></section>
  <script>
  window.__selectionBlockerCalls=0;
  document.querySelector('#selection-target').addEventListener('selectstart',event=>{window.__selectionBlockerCalls+=1;event.preventDefault()});
  document.addEventListener('contextmenu',event=>{const section=event.target.closest('[data-overlay-case]');window.__contextMenus.push({caseId:section?.dataset.overlayCase||null,role:event.target.dataset.role||null,defaultPrevented:event.defaultPrevented})});
  window.__diagnosticReady=true;
  </script></body></html>`;
}

function instrumentationCode() {
  return String.raw`(() => {
    const records = [];
    Object.defineProperty(window, "__contextMenus", { value: records, configurable: false });
    window.addEventListener("contextmenu", event => {
      const section = event.target.closest?.("[data-overlay-case]");
      const record = {
        caseId: section?.dataset.overlayCase || null,
        role: event.target.dataset?.role || null,
        defaultPrevented: event.defaultPrevented
      };
      records.push(record);
      queueMicrotask(() => { record.defaultPrevented = event.defaultPrevented; });
    }, { capture: true });
  })();`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
