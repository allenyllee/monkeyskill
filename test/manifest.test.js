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
    access(join(root, "src", "lib", "codex-app-server.js")),
    access(join(root, "agent-skills.json")),
    access(join(root, "skills", "mskill-attacker", "SKILL.md")),
    access(join(root, "skills", "mskill-creator", "SKILL.md")),
    access(join(root, "skills", "mskill-installer", "SKILL.md")),
    access(join(root, "skills", "mskill-tester", "SKILL.md")),
    access(join(root, "src", "validation", "offscreen.html")),
    access(join(root, "src", "validation", "sandbox.html"))
  ]);
});

test("experimental ChatGPT Agent path remains localhost-only and separate from BYOK", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const integration = await readFile(join(root, "docs", "codex-agent-integration.md"), "utf8");
  const options = await readFile(join(root, "src", "options", "options.html"), "utf8");
  const optionsScript = await readFile(join(root, "src", "options", "options.js"), "utf8");
  assert.match(readme, /codex app-server --listen ws:\/\/127\.0\.0\.1:4500/);
  assert.match(readme, /not yet a replacement for the four-role BYOK MSkill pipeline/);
  assert.match(integration, /Tester A, Attacker, Tester B, and Builder/);
  assert.match(integration, /MONKEYSKILL_AGENT_OK/);
  assert.match(options, /目前只提供連線、登入與隔離 smoke test/);
  assert.match(optionsScript, /codexAppServerOriginPattern\(agentUrl\.value\)/);
  assert.match(optionsScript, /chrome\.permissions\.request\(\{ origins: \[origin\] \}\)/);
});

test("agent Skill catalog preinstalls attacker, creator, installer, and tester policies", async () => {
  const catalog = JSON.parse(await readFile(join(root, "agent-skills.json"), "utf8"));
  assert.deepEqual(catalog.map(entry => entry.id), ["mskill-attacker", "mskill-creator", "mskill-installer", "mskill-tester"]);
  await Promise.all(catalog.map(entry => access(join(root, entry.entrypoint))));
});

test("operator docs describe the staged four-worker security gate", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const runbook = await readFile(join(root, "docs", "closed-loop-validation.md"), "utf8");
  assert.match(readme, /disposable Attacker, Builder, and Tester requests/);
  assert.match(readme, /Tester A `allow` plus Tester B `reject`/);
  assert.match(runbook, /Stop old Attacker, Builder, and Tester agents/);
  assert.match(runbook, /Trigger generation only after Tester A is ready/);
  assert.match(runbook, /Create or activate Builder only after B rejects/);
  assert.doesNotMatch(readme, /two fresh `fork_turns="none"` subagents/);
  assert.doesNotMatch(runbook, /Only after both workers are ready/);
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
  assert.match(creator, /mandatory differential security gate before Builder/);
  assert.match(creator, /A `reject` or `unverifiable` verdict stops immediately/);
  assert.match(creator, /Continue only when[\s\S]*Tester B returns `reject`/);
  assert.match(creator, /original=allow, poisoned=allow` is an injection-bypass failure/);
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
    offscreen.indexOf("evaluateDifferentialSecurityGate") < offscreen.indexOf("requestAssistantText(request, request.builderBody"),
    "The original and adversarial Tester verdicts must pass before Builder is contacted"
  );
  assert.match(offscreen, /if \(!gate\.proceed\)/);
});

test("Extension reload fails orphaned generation jobs without waiting for the stale timeout", async () => {
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  assert.match(background, /reconcileInterruptedGenerationJobs\(\)/);
  assert.match(background, /chrome\.offscreen\?\.hasDocument/);
  assert.match(background, /job\?\.state === "running"/);
  assert.match(background, /Generation was interrupted before completion\. Please retry\./);
});

test("Tester policy documents the browser-variant paste workflow", async () => {
  const tester = await readFile(join(root, "skills", "mskill-tester", "SKILL.md"), "utf8");
  assert.match(tester, /`unselectable`/);
  assert.match(tester, /resulting input event whose `data` is null/);
  assert.match(tester, /`inputType` is empty/);
});
