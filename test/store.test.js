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
});
