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

test("MSkill creator keeps domain behavior out of global prompts", async () => {
  const creator = await readFile(join(root, "skills", "mskill-creator", "SKILL.md"), "utf8");
  const schema = await readFile(join(root, "skills", "mskill-creator", "references", "mskill-schema.md"), "utf8");
  const methodology = await readFile(join(root, "docs", "evidence-driven-generative-development.md"), "utf8");
  assert.match(creator, /Global contract problem/);
  assert.match(creator, /MSkill specification problem/);
  assert.match(creator, /Candidate implementation problem/);
  assert.match(creator, /preserve that constraint in this MSkill rather than promoting it into a global prompt/);
  assert.match(creator, /record it in that MSkill under a clearly labeled validated-implementation section/);
  assert.match(creator, /Do not force future Builders to rediscover it/);
  assert.match(creator, /Reproduce the motivating browser problem/);
  assert.match(creator, /smallest useful set of criteria/);
  assert.match(creator, /Promote a demo failure into a new or clarified/);
  assert.match(creator, /candidate-only bug may be repaired without adding a new[\s\S]*criterion/);
  assert.match(creator, /security-review the MSkill before Builder runs/);
  assert.match(creator, /stop on `reject` or `unverifiable`/);
  assert.match(schema, /Global prompts own portable output shape, security, validation, and shared framework contracts/);
  assert.match(schema, /MSkill owns its domain behavior and platform conditions/);
  assert.match(schema, /Validated implementation constraints/);
  assert.match(schema, /self-contained reproducible demo/);
  assert.match(schema, /minimum criteria justified by the initial demo/);
  assert.match(schema, /machine-readable security verdict: `allow`, `reject`, or `unverifiable`/);
  assert.match(schema, /executable acceptance gates/);
  assert.match(creator, /evidence-driven-generative-development\.md/);
  assert.match(methodology, /Generated JavaScript and CSS are disposable derivatives/);
  assert.match(methodology, /Three layers of constraint/);
  assert.match(methodology, /Agreement between both TestSpecs is necessary, not sufficient/);
  assert.match(methodology, /A sensitive behavior outside[\s\S]*`unverifiable`/);
  assert.match(methodology, /Stability does not mean identical generated code/);
});

test("Extension does not bundle Store MSkills", async () => {
  await assert.rejects(access(join(root, "preinstalled-skills.json")));
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  assert.doesNotMatch(background, /install-bundled-skill|generate-bundled-skill|preinstalled-skills\.json/);
  assert.match(background, /case "generate-store-skill"/);
});

test("generation state is durable outside Store page lifetime", async () => {
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  const offscreen = await readFile(join(root, "src", "validation", "offscreen.js"), "utf8");
  assert.match(background, /const GENERATION_JOBS_KEY = "generationJobs"/);
  assert.match(background, /state: "running"/);
  assert.match(background, /state: "failed"/);
  assert.match(background, /state: "ready"/);
  assert.match(offscreen, /type: "generation-complete"/);
  assert.ok(
    offscreen.indexOf("await generateSecurityReview") < offscreen.indexOf("requestAssistantText(request, request.builderBody"),
    "Independent Tester security review must complete before Builder is contacted"
  );
  assert.match(offscreen, /securityReview\.verdict !== "allow"/);
});
