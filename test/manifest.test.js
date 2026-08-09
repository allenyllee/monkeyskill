import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("manifest references existing extension entrypoints and the external Store", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, undefined);
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(manifest.permissions.includes("userScripts"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.sandbox.pages.includes("src/validation/sandbox.html"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://allenyllee.github.io/monkeyskill-store/*"));
  assert.match(manifest.content_security_policy.sandbox, /connect-src 'none'/);
  await Promise.all([
    access(join(root, manifest.background.service_worker)),
    access(join(root, manifest.action.default_popup)),
    access(join(root, manifest.options_page)),
    access(join(root, "agent-skills.json")),
    access(join(root, "skills", "mskill-creator", "SKILL.md")),
    access(join(root, "skills", "mskill-installer", "SKILL.md")),
    access(join(root, "skills", "mskill-tester", "SKILL.md")),
    access(join(root, "src", "validation", "offscreen.html")),
    access(join(root, "src", "validation", "sandbox.html"))
  ]);
});

test("agent Skill catalog preinstalls creator, installer, and tester policies", async () => {
  const catalog = JSON.parse(await readFile(join(root, "agent-skills.json"), "utf8"));
  assert.deepEqual(catalog.map(entry => entry.id), ["mskill-creator", "mskill-installer", "mskill-tester"]);
  await Promise.all(catalog.map(entry => access(join(root, entry.entrypoint))));
});

test("Extension contains no bundled Store MSkill or generated right-click Build", async () => {
  await assert.rejects(access(join(root, "preinstalled-skills.json")));
  await assert.rejects(access(join(root, "packages", "restore-right-click.mskill.json")));
  await assert.rejects(access(join(root, "skills", "restore-right-click", "skill.json")));
  await assert.rejects(access(join(root, "generated", "restore-right-click", "1.2.0", "build.json")));
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  assert.doesNotMatch(background, /install-bundled-skill|generate-bundled-skill|preinstalled-skills\.json/);
  assert.match(background, /case "generate-store-skill"/);
});

test("demo exposes all 16 methods on one page", async () => {
  const demo = await readFile(join(root, "demo", "blocked.html"), "utf8");
  for (let method = 1; method <= 16; method += 1) assert.match(demo, new RegExp(`id="method-${method}"`));
  assert.match(demo, /id="standard-target"/);
  assert.match(demo, /id="absolute-target"/);
  assert.match(demo, /id="background-image-target"/);
  assert.match(demo, /removeAllRanges/);
  assert.match(demo, /event\.key\.toLowerCase\(\) !== "c"/);
});

test("generation state is durable outside Store page lifetime", async () => {
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  const offscreen = await readFile(join(root, "src", "validation", "offscreen.js"), "utf8");
  assert.match(background, /const GENERATION_JOBS_KEY = "generationJobs"/);
  assert.match(background, /state: "running"/);
  assert.match(background, /state: "failed"/);
  assert.match(background, /state: "ready"/);
  assert.match(offscreen, /type: "generation-complete"/);
});
