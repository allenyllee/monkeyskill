import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("local Store is bridged only on its approved URLs", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const [contentScript] = manifest.content_scripts;
  assert.deepEqual(contentScript.matches, [
    "http://127.0.0.1:4173/store.html",
    "http://localhost:4173/store.html"
  ]);
  assert.deepEqual(contentScript.js, ["src/store/bridge.js"]);

  const bridge = await readFile(new URL("src/store/bridge.js", root), "utf8");
  assert.match(bridge, /location\.pathname === "\/store\.html"/);
  for (const action of ["list", "generate", "approve", "discard", "pending", "status", "clear-history"]) {
    assert.match(bridge, new RegExp(`\\["${action}"`));
  }
});

test("background verifies Store senders and exposes catalog metadata", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(background, /assertStoreSender\(sender\)/);
  assert.match(background, /url\.pathname === "\/store\.html"/);
  assert.match(background, /case "list-skills"/);
  assert.match(background, /case "generate-bundled-skill"/);
  assert.match(background, /case "approve-generated-skill"/);
  assert.match(background, /case "clear-generation-history"/);
});

test("Store page provides two explicit approval decisions", async () => {
  const page = await readFile(new URL("demo/store.html", root), "utf8");
  const script = await readFile(new URL("demo/store.js", root), "utf8");
  const server = await readFile(new URL("scripts/serve-demo.mjs", root), "utf8");
  assert.match(page, /id="decision-dialog"/);
  assert.match(script, /是，開始生成/);
  assert.match(script, /是，核准安裝/);
  assert.match(script, /await rpc\("generate"/);
  assert.match(script, /await rpc\("approve"/);
  assert.match(script, /waitForGeneration/);
  assert.match(script, /job\?\.state === "ready"/);
  assert.match(script, /上次生成失敗/);
  assert.match(script, /清除紀錄/);
  assert.match(server, /\/store\.html/);
});

test("long LLM requests run outside the ephemeral service worker", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  assert.match(background, /type: "generate-package"/);
  assert.match(background, /message\?\.target === "generation-background"/);
  assert.match(background, /GENERATION_STALE_MS/);
  assert.match(background, /!result\.ok && !result\.inconclusive/);
  assert.match(offscreen, /async function runGenerationJob/);
  assert.match(offscreen, /await fetch\(request\.endpoint/);
  assert.match(offscreen, /builderSessionId = `builder-\$\{jobId\}`/);
  assert.match(offscreen, /testerSessionId = `tester-\$\{jobId\}`/);
  assert.match(offscreen, /headers\["x-monkeyskill-session"\] = sessionId/);
  assert.match(offscreen, /type: "generation-complete"/);
  const store = await readFile(new URL("demo/store.js", root), "utf8");
  assert.match(store, /Inconclusive tests:/);
});

test("independent TestSpec feedback cannot expose tester-controlled text", async () => {
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  const sandbox = await readFile(new URL("src/validation/sandbox.js", root), "utf8");
  assert.match(offscreen, /Promise\.all\(\[/);
  assert.match(offscreen, /request\.builderBody/);
  assert.match(offscreen, /request\.testerBody/);
  assert.match(offscreen, /buildRepairMessage\(failed\)/);
  assert.match(offscreen, /!result\.ok && !result\.inconclusive/);
  assert.match(offscreen, /runCapabilitySelfTests\(testSpec\)/);
  assert.doesNotMatch(offscreen, /buildRepairMessage\([^)]*(?:error|testSpec|test\.id)/);
  assert.doesNotMatch(sandbox, /runnerSource|monkeySkillAcceptanceTests/);
  assert.match(sandbox, /executeTest\(message\.test\)/);
  assert.match(sandbox, /executeCapabilitySelfTest\(message\.capability\)/);
  assert.match(sandbox, /trackedActiveElement/);
  assert.match(sandbox, /async function pasteText\(target, value\)/);
  assert.match(sandbox, /inputType: "insertFromPaste"/);
  assert.match(sandbox, /async function dragSelectText\(target\)/);
  assert.match(sandbox, /async function clickControl\(target\)/);
  assert.match(sandbox, /async function clickPage\(target\)/);
  assert.match(sandbox, /Chrome may report the still-live range/);
  assert.match(sandbox, /document\.dispatchEvent\(createEvent\("selectionchange", \{\}\)\)/);
  assert.match(sandbox, /element\.style\.setProperty\("position", "fixed", "important"\)/);
  assert.match(sandbox, /releaseClearEvents\.has\(event\.type\)/);
  assert.match(sandbox, /queueMicrotask\(\(\) => getSelection\(\)\?\.removeAllRanges\(\)\)/);
  assert.match(sandbox, /removeEventListener\("message", onRunTest\)/);
  assert.doesNotMatch(sandbox, /\{ once: true \}/);
});
