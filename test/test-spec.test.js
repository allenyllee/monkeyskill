import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractCriterionIds } from "../src/lib/llm.js";
import { parseGeneratedTestSpec, validateTestSpec } from "../src/lib/test-spec.js";

const skill = JSON.parse(await readFile(new URL("../skills/restore-right-click/skill.json", import.meta.url), "utf8"));
const instructions = await readFile(new URL("../skills/restore-right-click/SKILL.md", import.meta.url), "utf8");
const criteria = extractCriterionIds(instructions);
const fixtureText = await readFile(new URL("../scripts/fixtures/restore-right-click.testspec.json", import.meta.url), "utf8");

test("independently generated TestSpec covers every visible criterion", () => {
  const spec = parseGeneratedTestSpec(fixtureText, skill, criteria);
  assert.deepEqual(
    [...new Set(spec.tests.map(candidate => candidate.criterion))].sort(),
    [...new Set(criteria)].sort()
  );
});

test("TestSpec rejects executable or remote-content fields", () => {
  const spec = JSON.parse(fixtureText);
  spec.tests[0].fixture.nodes[0].html = "<script>fetch('https://evil')</script>";
  assert.throws(() => validateTestSpec(spec, skill, criteria), /unsupported fields/);
});

test("TestSpec rejects missing criteria and undeclared behavior", () => {
  const spec = JSON.parse(fixtureText);
  spec.tests = spec.tests.filter(candidate => candidate.criterion !== "context-menu");
  assert.throws(() => validateTestSpec(spec, skill, criteria), /does not cover/);

  const second = JSON.parse(fixtureText);
  second.tests[0].mode = "secret-mode";
  assert.throws(() => validateTestSpec(second, skill, criteria), /invalid kind or mode/);
});

test("TestSpec rejects network-bearing styles and external links", () => {
  const styleSpec = JSON.parse(fixtureText);
  styleSpec.tests[0].fixture.nodes[0].styles.backgroundImage = "url(https://evil.test/x)";
  assert.throws(() => validateTestSpec(styleSpec, skill, criteria), /load or execute/);

  const linkSpec = JSON.parse(fixtureText);
  linkSpec.tests[0].fixture.nodes[0].tag = "a";
  linkSpec.tests[0].fixture.nodes[0].attributes.href = "https://evil.test";
  assert.throws(() => validateTestSpec(linkSpec, skill, criteria), /local fragment/);
});

test("TestSpec supports generic dynamic DOM and blocker actions without JavaScript", () => {
  const spec = JSON.parse(fixtureText);
  const behavior = spec.tests.find(candidate => candidate.kind === "behavior");
  behavior.steps.push(
    { action: "append-node", node: { id: "dynamic-control", tag: "input", attributes: {}, styles: {} } },
    {
      action: "add-blocker",
      blocker: {
        id: "dynamic-blocker",
        target: "dynamic-control",
        event: "input",
        registration: "listener",
        effect: "rollback-value"
      }
    },
    { action: "set-attribute", target: "dynamic-control", name: "aria-label", value: "dynamic" },
    { action: "focus", target: "dynamic-control" },
    { action: "remove-attribute", target: "dynamic-control", name: "aria-label" },
    { action: "remove-node", target: "dynamic-control" }
  );
  behavior.assertions.push({ type: "blocker-call-count", blocker: "dynamic-blocker", operator: "eq", value: 0 });
  behavior.assertions.push({ type: "dom-present", target: "dynamic-control", expected: false });
  assert.doesNotThrow(() => validateTestSpec(spec, skill, criteria));
});

test("TestSpec can observe data-driven generated UI without implementation-specific selectors", () => {
  const spec = JSON.parse(fixtureText);
  const behavior = spec.tests.find(candidate => candidate.kind === "behavior");
  behavior.fixture.nodes[0].attributes["data-reading-time"] = "5 min";
  behavior.steps.push({
    action: "capture-node",
    id: "generated-badge",
    scope: behavior.fixture.nodes[0].id,
    relation: "descendant",
    match: { text: { operator: "eq", value: "5 min" } },
    index: 0
  });
  behavior.assertions.push({
    type: "node-count",
    scope: behavior.fixture.nodes[0].id,
    relation: "descendant",
    match: { text: { operator: "eq", value: "5 min" } },
    operator: "eq",
    value: 1
  });
  behavior.assertions.push({ type: "text-content", target: "generated-badge", operator: "eq", value: "5 min" });
  assert.doesNotThrow(() => validateTestSpec(spec, skill, criteria));
});
