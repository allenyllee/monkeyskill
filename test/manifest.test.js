import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("manifest references existing extension entrypoints", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, undefined);
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(manifest.permissions.includes("userScripts"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.sandbox.pages.includes("src/validation/sandbox.html"));
  assert.match(manifest.content_security_policy.sandbox, /'unsafe-inline'/);
  assert.match(manifest.content_security_policy.sandbox, /'unsafe-eval'/);
  assert.match(manifest.content_security_policy.sandbox, /connect-src 'none'/);

  await Promise.all([
    access(join(root, manifest.background.service_worker)),
    access(join(root, manifest.action.default_popup)),
    access(join(root, manifest.options_page)),
    access(join(root, "preinstalled-skills.json")),
    access(join(root, "agent-skills.json")),
    access(join(root, "skills", "mskill-creator", "SKILL.md")),
    access(join(root, "skills", "mskill-installer", "SKILL.md")),
    access(join(root, "src", "validation", "offscreen.html")),
    access(join(root, "src", "validation", "sandbox.html")),
    access(join(root, "src", "validation", "scenarios.js"))
  ]);
});

test("agent Skill catalog preinstalls creator and installer policies", async () => {
  const catalog = JSON.parse(await readFile(join(root, "agent-skills.json"), "utf8"));
  assert.deepEqual(catalog.map(entry => entry.id), ["mskill-creator", "mskill-installer"]);
  await Promise.all(catalog.map(entry => access(join(root, entry.entrypoint))));
});

test("the packaged skill declares no network capability", async () => {
  const skill = JSON.parse(await readFile(
    join(root, "skills", "restore-right-click", "skill.json"),
    "utf8"
  ));

  assert.ok(skill.capabilities.includes("dom"));
  assert.ok(skill.forbiddenCapabilities.includes("network"));
  assert.ok(!skill.capabilities.includes("network"));
});

test("preinstalled Skills point to separate specs and generated builds", async () => {
  const registry = JSON.parse(await readFile(join(root, "preinstalled-skills.json"), "utf8"));
  const [entry] = registry;
  assert.match(entry.package, /^packages\/.+\.mskill\.json$/);

  const descriptor = JSON.parse(await readFile(join(root, entry.package), "utf8"));
  assert.match(descriptor.skill, /^skills\//);
  assert.match(descriptor.build, /^generated\//);
  await Promise.all([access(join(root, descriptor.skill)), access(join(root, descriptor.build))]);

  const skill = JSON.parse(await readFile(join(root, descriptor.skill), "utf8"));
  const build = JSON.parse(await readFile(join(root, descriptor.build), "utf8"));
  assert.equal(descriptor.id, skill.id);
  assert.equal(build.skillId, skill.id);
  assert.equal(build.skillVersion, skill.version);

  const artifactPaths = Object.values(build.modes)
    .flatMap(mode => [...mode.js, ...mode.css]);
  await Promise.all(artifactPaths.map(path => access(join(root, path))));

  const specificationFiles = await readdir(join(root, "skills", skill.id), { recursive: true });
  const runtimeSource = specificationFiles.filter(path => /\.(?:js|css)$/i.test(path));
  assert.deepEqual(runtimeSource, []);

  const acceptance = JSON.parse(await readFile(join(root, "skills", skill.id, skill.tests), "utf8"));
  assert.equal(acceptance.schemaVersion, 2);
  assert.equal(acceptance.runner, undefined);
  const behaviorTests = acceptance.tests.filter(test => !test.type);
  assert.equal(behaviorTests.filter(test => test.id.startsWith("method-")).length, 16);
  assert.equal(behaviorTests.length, 17);
  const runner = await readFile(join(root, "src", "validation", "scenarios.js"), "utf8");
  for (const test of acceptance.tests.filter(test => !test.type)) {
    assert.deepEqual(Object.keys(test).sort(), ["criterion", "id", "mode", "scenario"]);
    assert.match(runner, new RegExp(`"${test.scenario}"`));
  }
  const criteria = [...(await readFile(join(root, "skills", skill.id, skill.entrypoint), "utf8"))
    .matchAll(/\[criterion:([a-z0-9-]+)\]/g)].map(match => match[1]);
  assert.deepEqual(
    [...new Set(acceptance.tests.map(test => test.criterion))].sort(),
    [...new Set(criteria)].sort()
  );
  assert.match(runner, /style\.backgroundImage\.includes\("linear-gradient"\)/);
});

test("demo exposes all 16 methods on one page", async () => {
  const demo = await readFile(join(root, "demo", "blocked.html"), "utf8");
  for (let method = 1; method <= 16; method += 1) {
    assert.match(demo, new RegExp(`id="method-${method}"`));
  }
  assert.match(demo, /id="standard-target"/);
  assert.match(demo, /id="absolute-target"/);
  assert.match(demo, /id="background-image-target"/);
  assert.match(demo, /removeAllRanges/);
  assert.match(demo, /event\.key\.toLowerCase\(\) !== "c"/);
});

test("Absolute build covers structural right-click blockers", async () => {
  const packageDescriptor = JSON.parse(await readFile(
    join(root, "packages", "restore-right-click.mskill.json"),
    "utf8"
  ));
  const build = JSON.parse(await readFile(join(root, packageDescriptor.build), "utf8"));
  const absoluteSource = await readFile(join(root, build.modes.absolute.js[0]), "utf8");
  const absoluteStyles = await readFile(join(root, build.modes.absolute.css[0]), "utf8");

  assert.match(absoluteSource, /pointer-events/);
  assert.match(absoluteSource, /onmousedown/);
  assert.match(absoluteSource, /isCancellingInlineHandler/);
  assert.match(absoluteSource, /substantiallyOverlaps/);
  assert.match(absoluteSource, /\["mouseup", "keyup", "touchend"\]/);
  assert.match(absoluteSource, /insertFromPaste/);
  assert.match(absoluteStyles, /\*::selection/);
});

test("generation status survives an options-page refresh", async () => {
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  const options = await readFile(join(root, "src", "options", "options.js"), "utf8");
  assert.match(background, /const GENERATION_JOBS_KEY = "generationJobs"/);
  assert.match(background, /state: "running"/);
  assert.match(background, /state: "failed"/);
  assert.match(background, /state: "ready"/);
  assert.match(options, /changes\.generationJobs/);
  assert.match(options, /get-generation-status/);
});
