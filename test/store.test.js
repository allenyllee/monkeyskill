import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Store bridge is limited to local development and the official Pages origin", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const [contentScript] = manifest.content_scripts;
  assert.deepEqual(contentScript.matches, [
    "http://127.0.0.1:4174/*",
    "http://localhost:4174/*",
    "https://allenyllee.github.io/monkeyskill-store/*"
  ]);
  assert.deepEqual(contentScript.js, ["src/store/bridge.js"]);
  const bridge = await readFile(new URL("src/store/bridge.js", root), "utf8");
  assert.match(bridge, /store-list-installed-skills/);
  assert.match(bridge, /store-generate-store-skill/);
  assert.match(bridge, /skillPackage/);
  assert.match(bridge, /request\.action === "ping"/);
  assert.match(bridge, /response: \{ ok: true \}/);
  assert.match(bridge, /if \(localPage\) \{/);
  assert.match(bridge, /actions\.set\("reload-extension", "store-reload-extension"\)/);
  assert.match(bridge, /actions\.set\("set-test-mode", "store-set-test-mode"\)/);
});

test("automatic Extension reload is restricted to the local development Store", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(background, /case "reload-extension"/);
  assert.match(background, /assertLocalReloadSender\(sender\)/);
  assert.match(background, /\["127\.0\.0\.1", "localhost"\]/);
  assert.match(background, /url\.port === "4174"/);
  assert.match(background, /chrome\.runtime\.reload\(\)/);
});

test("closed-loop mode switching is restricted to the local development Store", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(background, /case "set-test-mode"/);
  assert.match(background, /assertLocalReloadSender\(sender\)/);
  assert.match(background, /config\.globalMode = message\.mode/);
});

test("background accepts only manifest and SKILL.md from an approved Store", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(background, /assertStoreSender\(sender\)/);
  assert.match(background, /case "generate-store-skill"/);
  assert.match(background, /\["skill", "instructions"\]/);
  assert.match(background, /packages may contain only a manifest and SKILL\.md text/);
  assert.match(background, /https:\/\/allenyllee\.github\.io/);
  assert.match(background, /const TRUSTED_STORES_KEY = "trustedStoreUrls"/);
  assert.match(background, /syncTrustedStoreBridges/);
  assert.match(background, /chrome\.permissions\.contains/);
  assert.doesNotMatch(background, /loadBundledPackage/);
});

test("options can add and remove forked Store origins after permission approval", async () => {
  const options = await readFile(new URL("src/options/options.js", root), "utf8");
  assert.match(options, /type: "add-trusted-store"/);
  assert.match(options, /type: "remove-trusted-store"/);
  assert.match(options, /chrome\.permissions\.request/);
  assert.match(options, /\$\{url\.origin\}\/\*/);
});

test("long LLM requests still run outside the ephemeral service worker", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  assert.match(background, /type: "generate-package"/);
  assert.match(background, /message\?\.target === "generation-background"/);
  assert.match(offscreen, /async function runGenerationJob/);
  assert.match(offscreen, /request\.builderBody/);
  assert.match(offscreen, /request\.testerBody/);
  assert.match(offscreen, /specification: packageDefinition\.specification/);
  assert.match(offscreen, /type: "generation-progress"/);
  assert.match(offscreen, /setInterval/);
  assert.match(background, /job\.updatedAt \|\| job\.startedAt/);
});
