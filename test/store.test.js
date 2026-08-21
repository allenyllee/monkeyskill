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
  assert.match(bridge, /store-verify-runner-bootstrap/);
  assert.match(bridge, /observeRunnerBootstrap/);
  assert.match(bridge, /cache: "no-store"/);
  assert.match(bridge, /credentials: "omit"/);
  assert.match(bridge, /redirect: "error"/);
  assert.match(bridge, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(bridge, /Runner Bootstrap package hash is invalid/);
  assert.match(bridge, /skillPackage/);
  assert.match(bridge, /request\.action === "ping"/);
  assert.match(bridge, /response: \{ ok: true \}/);
  assert.match(bridge, /if \(localPage\) \{/);
  assert.match(bridge, /actions\.set\("reload-extension", "store-reload-extension"\)/);
  assert.match(bridge, /actions\.set\("set-test-mode", "store-set-test-mode"\)/);
});

test("verified Runner Bootstrap prompt is pinned and copied by Extension-owned code", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  const bridge = await readFile(new URL("src/store/bridge.js", root), "utf8");
  const popupHtml = await readFile(new URL("src/popup/popup.html", root), "utf8");
  const popupJs = await readFile(new URL("src/popup/popup.js", root), "utf8");
  const policy = await readFile(new URL("src/lib/runner-bootstrap-policy.js", root), "utf8");
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  assert.match(background, /case "verify-runner-bootstrap"/);
  assert.match(background, /validateRunnerBootstrapObservation/);
  assert.match(background, /buildVerifiedRunnerBootstrapPrompt/);
  assert.match(background, /clipboardText: prompt/);
  assert.match(background, /reasons: \["IFRAME_SCRIPTING"\]/);
  assert.match(policy, /eb4d2956a00f5d2232fe0a06a0f58b050bc831502cafc48e6286db5248701869/);
  assert.match(policy, /protocolSchemaVersion: 2/);
  assert.doesNotMatch(offscreen, /write-verified-bootstrap-prompt/);
  assert.match(bridge, /const \{ clipboardText, confirmationToken, \.\.\.publicResponse \} = response/);
  assert.match(bridge, /document\.execCommand\("copy"\)/);
  assert.match(bridge, /store-confirm-runner-bootstrap-copy/);
  assert.match(background, /case "confirm-runner-bootstrap-copy"/);
  assert.match(background, /chrome\.action\.openPopup/);
  assert.match(background, /chrome\.action\.setBadgeText\(\{ text: "✓" \}\)/);
  assert.match(popupHtml, /id="bootstrap-copy-notice"/);
  assert.match(popupJs, /runnerBootstrapCopyNotice/);
  assert.match(popupJs, /bootstrapCopyNotice\.hidden = false/);
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

test("background accepts only manifest, SKILL.md, and constrained conformance from an approved Store", async () => {
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(background, /assertStoreSender\(sender\)/);
  assert.match(background, /case "generate-store-skill"/);
  assert.match(background, /\["skill", "instructions", "developerConformance"\]/);
  assert.match(background, /packages may contain only a manifest, SKILL\.md text, and constrained Developer Conformance/);
  assert.match(background, /validateDeveloperConformance/);
  assert.match(background, /https:\/\/allenyllee\.github\.io/);
  assert.match(background, /const TRUSTED_STORES_KEY = "trustedStoreUrls"/);
  assert.match(background, /syncTrustedStoreBridges/);
  assert.match(background, /chrome\.permissions\.contains/);
  assert.doesNotMatch(background, /loadBundledPackage/);
});

test("Developer Conformance is isolated, strict, and uses constrained repair diagnostics", async () => {
  const offscreen = await readFile(new URL("src/validation/offscreen.js", root), "utf8");
  const background = await readFile(new URL("src/background.js", root), "utf8");
  assert.match(offscreen, /const blockedDeveloperTests = developerResponse\.results\.filter\(result => !result\.ok\)/);
  assert.match(offscreen, /buildRepairMessage\(blockedDeveloperTests\)/);
  assert.doesNotMatch(offscreen, /buildPublicTestSpecRepairMessage\(blockedDeveloperTests\)/);
  assert.match(background, /Developer Conformance cannot be failed or inconclusive at approval/);
  assert.match(background, /run-developer-conformance/);
  assert.match(background, /ensureValidationBrowserDocument/);
  assert.match(background, /target: "validation-browser"/);
  assert.match(background, /chrome\.tabs\.create\(\{ url, active: false \}\)/);
  assert.match(offscreen, /VALIDATION_BACKEND/);
  assert.match(offscreen, /target: "validation-browser"/);
  assert.match(offscreen, /isLocalAgentEndpoint\(request\.endpoint\)/);
  assert.match(offscreen, /\/v1\/real-browser-conformance/);
  assert.match(offscreen, /attempt < 2/);
  assert.match(offscreen, /response\.status < 500 \|\| attempt === 1/);
  assert.match(background, /isLocalAgentEndpoint\(settings\.endpoint\)/);
  assert.match(background, /runLocalRealBrowserConformance\(settings, developerTestSpec/);
  assert.match(background, /attempt < 2/);
  assert.match(background, /response\.status < 500 \|\| attempt === 1/);
  assert.match(offscreen, /inconclusiveDeveloperTests/);
  assert.match(offscreen, /Inconclusive checks are not Builder failures and cannot trigger repair/);
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
  assert.match(offscreen, /request\.attackerBody/);
  assert.match(offscreen, /request\.testerBody/);
  assert.match(offscreen, /tester-original-/);
  assert.match(offscreen, /attacker-/);
  assert.match(offscreen, /tester-adversarial-/);
  assert.match(offscreen, /differential-security-gate:original=/);
  assert.match(offscreen, /securityReview\.verdict !== "allow"/);
  assert.ok(offscreen.indexOf("securityReview.verdict !== \"allow\"") < offscreen.indexOf("request.attackerBody"));
  assert.match(offscreen, /Differential security gate failed/);
  assert.match(offscreen, /formatDifferentialGateFailure/);
  assert.match(offscreen, /Attacker, Tester B, and Builder were not contacted/);
  assert.match(offscreen, /specification: packageDefinition\.specification/);
  assert.match(offscreen, /type: "generation-progress"/);
  assert.match(offscreen, /setInterval/);
  assert.match(background, /job\.updatedAt \|\| job\.startedAt/);
});
