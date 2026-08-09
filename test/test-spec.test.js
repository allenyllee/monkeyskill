import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractCriterionIds } from "../src/lib/llm.js";
import { parseGeneratedTestSpec, validateTestSpec } from "../src/lib/test-spec.js";

const fixtureText = await readFile(new URL("../scripts/fixtures/runner.testspec.json", import.meta.url), "utf8");
const fixtureCriteria = [...new Set(JSON.parse(fixtureText).tests.map(test => test.criterion))];
const skill = {
  schemaVersion: 1,
  id: "runner-fixture",
  name: "Runner fixture",
  version: "1.0.0",
  description: "Test-only Runner fixture.",
  capabilities: ["dom", "events", "styles"],
  forbiddenCapabilities: ["network", "cookies", "history", "downloads"],
  modes: ["standard", "absolute"],
  entrypoint: "SKILL.md"
};
const criteria = extractCriterionIds(fixtureCriteria.map(id => `[criterion:${id}]`).join("\n"));

test("independently generated TestSpec covers every visible criterion", () => {
  const spec = parseGeneratedTestSpec(fixtureText, skill, criteria);
  assert.deepEqual(
    [...new Set(spec.tests.map(candidate => candidate.criterion))].sort(),
    [...new Set(criteria)].sort()
  );
});

test("pointer overlay fixture has stable geometry without loading media", () => {
  const spec = parseGeneratedTestSpec(fixtureText, skill, criteria);
  const pointerTest = spec.tests.find(candidate => candidate.criterion === "pointer-overlays");
  const target = pointerTest.fixture.nodes.find(node => node.id === "target");
  assert.equal(target.tag, "canvas");
  assert.deepEqual(target.attributes, {});
  assert.equal(target.styles.width, "240px");
  assert.equal(target.styles.height, "120px");
  assert.deepEqual(target.rect, { x: 8, y: 8, width: 240, height: 120 });
  assert.deepEqual(
    pointerTest.fixture.nodes.find(node => node.id === "overlay").rect,
    target.rect
  );
});

test("fixture rectangles are declarative, bounded, and non-executable", () => {
  const spec = JSON.parse(fixtureText);
  const node = spec.tests.find(candidate => candidate.kind === "behavior").fixture.nodes[0];
  node.rect = { x: 10, y: 20, width: 300, height: 100 };
  assert.doesNotThrow(() => validateTestSpec(spec, skill, criteria));

  node.rect.width = -1;
  assert.throws(() => validateTestSpec(spec, skill, criteria), /rectangle width is invalid/i);

  node.rect = { x: 0, y: 0, width: 100, height: 100, script: "alert(1)" };
  assert.throws(() => validateTestSpec(spec, skill, criteria), /unsupported fields/);
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
  assert.throws(() => validateTestSpec(styleSpec, skill, criteria), /load.*execute/);

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
    { action: "paste-text", target: "dynamic-control", value: "pasted" },
    { action: "set-attribute", target: "dynamic-control", name: "aria-label", value: "dynamic" },
    { action: "focus", target: "dynamic-control" },
    { action: "remove-attribute", target: "dynamic-control", name: "aria-label" },
    { action: "remove-node", target: "dynamic-control" }
  );
  behavior.assertions.push({ type: "dom-present", target: "dynamic-control", expected: false });
  assert.doesNotThrow(() => validateTestSpec(spec, skill, criteria));
});

test("TestSpec requires high-level paste and drag-selection workflows", () => {
  const valid = JSON.parse(fixtureText);
  assert.doesNotThrow(() => validateTestSpec(valid, skill, criteria));

  const weakPaste = JSON.parse(fixtureText);
  const paste = weakPaste.tests.find(candidate => candidate.criterion === "paste");
  paste.steps = [
    { action: "set-value", target: "target", value: "pasted text" },
    { action: "dispatch-event", target: "target", event: "paste", init: {} }
  ];
  assert.throws(() => validateTestSpec(weakPaste, skill, criteria), /paste-text workflow/);

  const weakSelection = JSON.parse(fixtureText);
  const selection = weakSelection.tests.find(candidate => candidate.criterion === "text-selection");
  selection.steps = [
    { action: "select-contents", target: "target" },
    { action: "dispatch-event", target: "target", event: "mouseup", init: { button: 0 } }
  ];
  assert.throws(() => validateTestSpec(weakSelection, skill, criteria), /drag-select-text workflow/);

  const implementationSpecific = JSON.parse(fixtureText);
  const implementationPaste = implementationSpecific.tests.find(candidate => candidate.criterion === "paste");
  implementationPaste.assertions.push({
    type: "blocker-call-count",
    blocker: "rollback",
    operator: "eq",
    value: 0
  });
  assert.throws(() => validateTestSpec(implementationSpecific, skill, criteria), /observable outcome of effectful blockers/);
});

test("keyboard shortcut blockers require the copy-shortcut workflow", () => {
  const parsed = parseGeneratedTestSpec(fixtureText, skill, criteria);
  const keyboardTests = parsed.tests.filter(candidate => candidate.criterion === "keyboard-copy");
  const keyboard = keyboardTests[0];
  assert.equal(keyboard.steps[0].action, "copy-shortcut");
  assert.ok(keyboardTests.some(candidate => candidate.blockers.some(blocker => (
    blocker.registration === "property" && blocker.effect === "return-false"
  ))));

  const weak = JSON.parse(fixtureText);
  const weakKeyboard = weak.tests.find(candidate => candidate.criterion === "keyboard-copy");
  weakKeyboard.steps = [{ action: "dispatch-event", target: "target", event: "keydown", init: { key: "c", ctrlKey: true } }];
  assert.throws(() => validateTestSpec(weak, skill, criteria), /copy-shortcut workflow/);

  const invalidReturn = JSON.parse(fixtureText);
  const propertyTest = invalidReturn.tests.find(candidate => candidate.id === "keyboard-copy-property-return-false");
  propertyTest.blockers[0].registration = "listener";
  assert.throws(() => validateTestSpec(invalidReturn, skill, criteria), /return-false requires/);
});

test("selection fixtures model primary mousedown and high-specificity transparent highlights", () => {
  const parsed = parseGeneratedTestSpec(fixtureText, skill, criteria);
  const selection = parsed.tests.find(candidate => candidate.criterion === "text-selection");
  assert.deepEqual(selection.blockers.map(blocker => blocker.event), ["mousedown", "selectstart"]);

  const visibility = parsed.tests.find(candidate => candidate.criterion === "selection-visibility");
  assert.equal(visibility.fixture.rules[0].specificity, "id-ancestor");

  const duplicatedImportant = JSON.parse(fixtureText);
  const invalidRule = duplicatedImportant.tests.find(candidate => candidate.criterion === "selection-visibility");
  invalidRule.fixture.rules[0].styles.backgroundColor = "transparent !important";
  assert.throws(() => validateTestSpec(duplicatedImportant, skill, criteria), /Style value may escape/);
});

test("preserve-controls fixture models a real click after page selection", () => {
  const spec = parseGeneratedTestSpec(fixtureText, skill, criteria);
  const preserve = spec.tests.find(candidate => candidate.criterion === "preserve-controls");
  assert.deepEqual(preserve.steps.map(step => step.action), [
    "drag-select-text",
    "click-control",
    "set-value"
  ]);
  assert.ok(preserve.assertions.some(assertion => assertion.type === "selection-collapsed" && assertion.expected));
  assert.ok(preserve.assertions.some(assertion => assertion.type === "active-element" && assertion.expected));
});

test("selection-dismissal fixture models a real page click after selection", () => {
  const spec = parseGeneratedTestSpec(fixtureText, skill, criteria);
  const dismissal = spec.tests.find(candidate => candidate.criterion === "selection-dismissal");
  assert.deepEqual(dismissal.steps.map(step => step.action), [
    "drag-select-text",
    "click-page"
  ]);
  assert.ok(dismissal.assertions.some(assertion => assertion.type === "selection-collapsed" && assertion.expected));
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

test("TestSpec exposes trusted equivalents for common JavaScript visual checks", () => {
  const spec = JSON.parse(fixtureText);
  const behavior = spec.tests.find(candidate => candidate.kind === "behavior");
  behavior.fixture.nodes.push({
    id: "peer",
    tag: "button",
    parent: null,
    text: "Peer",
    attributes: { "aria-label": "Peer control" },
    styles: { width: "120px", height: "40px", backgroundColor: "rgb(255,255,255)", color: "rgb(0,0,0)" }
  });
  behavior.steps.push(
    { action: "focus", target: "peer" },
    { action: "click", target: "peer" },
    { action: "set-checked", target: "peer", value: true },
    { action: "scroll", target: "peer", left: 0, top: 0 }
  );
  behavior.assertions.push(
    { type: "visible", target: "peer", expected: true },
    { type: "active-element", target: "peer", expected: true },
    { type: "hit-test", target: "peer", point: "center", expected: true },
    { type: "bounding-rect", target: "peer", property: "width", operator: "approx", value: 120, tolerance: 1 },
    { type: "relative-position", target: "peer", other: "target", relation: "not-overlaps", tolerance: 0 },
    { type: "contrast-ratio", target: "peer", operator: "gte", value: 4.5 },
    { type: "scroll-offset", target: "peer", axis: "top", operator: "eq", value: 0, tolerance: 0 },
    { type: "property", target: "peer", name: "checked", expected: true },
    { type: "attribute", target: "peer", name: "aria-label", operator: "contains", value: "Peer" },
    { type: "attribute-refers-to", target: "target", name: "aria-describedby", other: "peer", expected: false }
  );
  assert.doesNotThrow(() => validateTestSpec(spec, skill, criteria));
});

test("expanded visual DSL still rejects executable and network-bearing primitives", () => {
  const spec = JSON.parse(fixtureText);
  const behavior = spec.tests.find(candidate => candidate.kind === "behavior");
  behavior.fixture.nodes[0].attributes.src = "https://evil.test/pixel";
  assert.throws(() => validateTestSpec(spec, skill, criteria), /attribute is not allowed/);

  const invalidGeometry = JSON.parse(fixtureText);
  invalidGeometry.tests.find(candidate => candidate.kind === "behavior").assertions.push({
    type: "bounding-rect",
    target: "target",
    property: "width",
    operator: "execute",
    value: 10
  });
  assert.throws(() => validateTestSpec(invalidGeometry, skill, criteria), /operator is invalid/);

  const escapedStyle = JSON.parse(fixtureText);
  escapedStyle.tests.find(candidate => candidate.kind === "behavior").fixture.nodes[0].styles.color = "red;} * {display:none";
  assert.throws(() => validateTestSpec(escapedStyle, skill, criteria), /escape, load, or execute/);
});
