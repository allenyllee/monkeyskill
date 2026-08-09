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
  for (const action of ["list", "generate", "approve", "discard", "pending", "status"]) {
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
  assert.match(server, /\/store\.html/);
});

test("long LLM requests run outside the ephemeral service worker", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  assert.match(background, /type: "generate-package"/);
  assert.match(background, /message\?\.target === "generation-background"/);
  assert.match(background, /GENERATION_STALE_MS/);
  assert.match(offscreen, /async function runGenerationJob/);
  assert.match(offscreen, /await fetch\(request\.endpoint/);
  assert.match(offscreen, /type: "generation-complete"/);
});

test("independent TestSpec feedback cannot expose tester-controlled text", async () => {
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  const sandbox = await readFile(new URL("src/validation/sandbox.js", root), "utf8");
  assert.match(offscreen, /Promise\.all\(\[/);
  assert.match(offscreen, /request\.builderBody/);
  assert.match(offscreen, /request\.testerBody/);
  assert.match(offscreen, /buildRepairMessage\(failed\)/);
  assert.doesNotMatch(offscreen, /buildRepairMessage\([^)]*(?:error|testSpec|test\.id)/);
  assert.doesNotMatch(sandbox, /runnerSource|monkeySkillAcceptanceTests/);
  assert.match(sandbox, /executeTest\(message\.test\)/);
});
