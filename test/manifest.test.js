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

  await Promise.all([
    access(join(root, manifest.background.service_worker)),
    access(join(root, manifest.action.default_popup)),
    access(join(root, manifest.options_page)),
    access(join(root, "preinstalled-skills.json"))
  ]);
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
  assert.equal(specificationFiles.some(path => /\.(?:js|css)$/i.test(path)), false);
});

test("demo exposes separate Standard and Absolute targets", async () => {
  const demo = await readFile(join(root, "demo", "blocked.html"), "utf8");
  assert.match(demo, /id="standard-target"/);
  assert.match(demo, /id="absolute-target"/);
  assert.match(demo, /selectionchange/);
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
