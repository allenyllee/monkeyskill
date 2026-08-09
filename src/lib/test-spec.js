const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_TESTS = 40;
const MAX_NODES = 30;
const MAX_ITEMS = 40;
const ALLOWED_TAGS = new Set([
  "a", "article", "button", "canvas", "div", "footer", "form", "header", "img",
  "input", "label", "main", "nav", "p", "section", "span", "textarea"
]);
const ALLOWED_ATTRIBUTES = new Set([
  "alt", "aria-label", "class", "contenteditable", "href", "role", "tabindex", "title", "type", "value"
]);
const ALLOWED_STYLES = new Set([
  "backgroundColor", "backgroundImage", "color", "display", "height", "inset", "opacity",
  "pointerEvents", "position", "userSelect", "visibility", "width", "zIndex"
]);
const ALLOWED_EVENTS = new Set([
  "click", "contextmenu", "copy", "cut", "dragstart", "input", "keydown", "keyup",
  "mousedown", "mouseup", "paste", "selectstart", "touchend"
]);
const ALLOWED_EFFECTS = new Set([
  "clear-selection", "flag-only", "prevent-default", "prevent-default-and-stop", "rollback-value"
]);
const ALLOWED_ACTIONS = new Set([
  "add-blocker", "append-node", "capture-node", "dispatch-event", "focus", "remove-attribute", "remove-node",
  "select-contents", "set-attribute", "set-style", "set-value", "wait"
]);
const ALLOWED_ASSERTIONS = new Set([
  "attribute", "blocker-call-count", "computed-style", "dom-present", "event-default-prevented",
  "node-count", "selection-collapsed", "text-content", "value"
]);
const ALLOWED_OPERATORS = new Set(["absent", "contains", "eq", "exists", "gte", "neq"]);
export const FAILURE_CATEGORIES = Object.freeze([
  "attribute-state", "blocker-state", "computed-style", "dom-state", "event-state", "selection-state", "value-state"
]);

export function parseGeneratedTestSpec(text, skill, criteria) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let spec;
  try {
    spec = JSON.parse(cleaned);
  } catch {
    throw new Error("Tester LLM did not return valid JSON.");
  }
  return validateTestSpec(spec, skill, criteria);
}

export function validateTestSpec(spec, skill, criteria) {
  if (spec?.schemaVersion !== 1 || !Array.isArray(spec.tests)) {
    throw new Error("Tester LLM returned an unsupported TestSpec schema.");
  }
  if (spec.tests.length === 0 || spec.tests.length > MAX_TESTS) {
    throw new Error(`TestSpec must contain between 1 and ${MAX_TESTS} tests.`);
  }
  assertOnlyKeys(spec, ["schemaVersion", "tests"], "TestSpec");
  const criterionSet = new Set(criteria);
  const covered = new Set();
  const ids = new Set();
  const normalized = [];

  for (const source of spec.tests) {
    assertRecord(source, "TestSpec test");
    if (!ID_PATTERN.test(source.id || "") || ids.has(source.id)) throw new Error("TestSpec test ID is invalid or duplicated.");
    ids.add(source.id);
    if (!criterionSet.has(source.criterion)) throw new Error("TestSpec references a criterion absent from SKILL.md.");
    covered.add(source.criterion);
    if (source.kind === "policy") normalized.push(validatePolicyTest(source, skill));
    else normalized.push(validateBehaviorTest(source, skill));
  }

  const missing = [...criterionSet].filter(criterion => !covered.has(criterion));
  if (missing.length > 0) throw new Error(`TestSpec does not cover SKILL.md criteria: ${missing.join(", ")}`);
  return { schemaVersion: 1, tests: normalized };
}

function validatePolicyTest(source, skill) {
  assertOnlyKeys(source, ["id", "kind", "criterion", "capability", "expected"], "policy test");
  if (source.expected !== "denied" || !skill.forbiddenCapabilities.includes(source.capability)) {
    throw new Error("Policy test must deny a capability declared forbidden by the MSkill.");
  }
  if (source.criterion !== `no-${source.capability}`) {
    throw new Error("Policy-test criterion must use the no-<capability> convention.");
  }
  return {
    id: source.id,
    kind: "policy",
    criterion: source.criterion,
    capability: source.capability,
    expected: "denied"
  };
}

function validateBehaviorTest(source, skill) {
  assertOnlyKeys(source, ["id", "kind", "criterion", "mode", "fixture", "blockers", "steps", "assertions"], "behavior test");
  if (source.kind !== "behavior" || !skill.modes.includes(source.mode)) throw new Error("Behavior test uses an invalid kind or mode.");
  const fixture = validateFixture(source.fixture);
  const nodeIds = new Set(fixture.nodes.map(node => node.id));
  const blockers = boundedArray(source.blockers, "blockers").map(blocker => validateBlocker(blocker, nodeIds));
  const blockerIds = new Set(blockers.map(blocker => blocker.id));
  if (blockerIds.size !== blockers.length) throw new Error("Blocker IDs must be unique.");
  const steps = boundedArray(source.steps, "steps").map(step => validateStep(step, nodeIds, blockerIds));
  const assertions = boundedArray(source.assertions, "assertions", false).map(assertion => (
    validateAssertion(assertion, nodeIds, blockerIds, steps.length)
  ));
  return { id: source.id, kind: "behavior", criterion: source.criterion, mode: source.mode, fixture, blockers, steps, assertions };
}

function validateFixture(source) {
  assertRecord(source, "fixture");
  assertOnlyKeys(source, ["nodes", "rules"], "fixture");
  if (!Array.isArray(source.nodes) || source.nodes.length === 0 || source.nodes.length > MAX_NODES) {
    throw new Error(`Fixture must contain between 1 and ${MAX_NODES} nodes.`);
  }
  const ids = new Set();
  const nodes = source.nodes.map(node => {
    assertRecord(node, "fixture node");
    assertOnlyKeys(node, ["id", "tag", "parent", "text", "attributes", "styles"], "fixture node");
    if (!ID_PATTERN.test(node.id || "") || ids.has(node.id)) throw new Error("Fixture node ID is invalid or duplicated.");
    if (!ALLOWED_TAGS.has(node.tag)) throw new Error("Fixture uses a disallowed HTML tag.");
    if (node.parent && !ids.has(node.parent)) throw new Error("Fixture parent must refer to an earlier node.");
    ids.add(node.id);
    return {
      id: node.id,
      tag: node.tag,
      parent: node.parent || null,
      text: safeText(node.text || "", 500),
      attributes: validateStringMap(node.attributes, ALLOWED_ATTRIBUTES, "attribute"),
      styles: validateStringMap(node.styles, ALLOWED_STYLES, "style")
    };
  });
  const rules = boundedArray(source.rules || [], "fixture rules").map(rule => {
    assertRecord(rule, "fixture rule");
    assertOnlyKeys(rule, ["target", "pseudo", "styles"], "fixture rule");
    if (!ids.has(rule.target) || rule.pseudo !== "::selection") throw new Error("Fixture rule target or pseudo-element is invalid.");
    return {
      target: rule.target,
      pseudo: rule.pseudo,
      styles: validateStringMap(rule.styles, ALLOWED_STYLES, "style")
    };
  });
  return { nodes, rules };
}

function validateBlocker(source, nodeIds) {
  assertRecord(source, "blocker");
  assertOnlyKeys(source, ["id", "target", "event", "registration", "effect", "when"], "blocker");
  if (!ID_PATTERN.test(source.id || "") || !nodeIds.has(source.target)) throw new Error("Blocker ID or target is invalid.");
  if (!ALLOWED_EVENTS.has(source.event)) throw new Error("Blocker event is not allowed.");
  if (!["listener", "inline"].includes(source.registration) || !ALLOWED_EFFECTS.has(source.effect)) {
    throw new Error("Blocker registration or effect is not allowed.");
  }
  return {
    id: source.id,
    target: source.target,
    event: source.event,
    registration: source.registration,
    effect: source.effect,
    when: validateEventInit(source.when || {})
  };
}

function validateStep(source, nodeIds, blockerIds) {
  assertRecord(source, "step");
  if (!ALLOWED_ACTIONS.has(source.action)) throw new Error("TestSpec action is not allowed.");
  if (source.action === "wait") {
    assertOnlyKeys(source, ["action", "ms"], "wait step");
    if (!Number.isInteger(source.ms) || source.ms < 0 || source.ms > 500) throw new Error("Wait duration is invalid.");
    return { action: "wait", ms: source.ms };
  }
  if (source.action === "append-node") {
    assertOnlyKeys(source, ["action", "node"], "append-node step");
    const parent = source.node?.parent || null;
    if (parent && !nodeIds.has(parent)) throw new Error("Appended node parent is invalid.");
    const fixture = validateFixture({ nodes: [{ ...source.node, parent: null }], rules: [] });
    if (nodeIds.has(fixture.nodes[0].id)) throw new Error("Appended node ID is duplicated.");
    const node = { ...fixture.nodes[0], parent };
    nodeIds.add(node.id);
    return { action: "append-node", node };
  }
  if (source.action === "add-blocker") {
    assertOnlyKeys(source, ["action", "blocker"], "add-blocker step");
    const blocker = validateBlocker(source.blocker, nodeIds);
    if (blockerIds.has(blocker.id)) throw new Error("Dynamically added blocker ID is duplicated.");
    blockerIds.add(blocker.id);
    return { action: "add-blocker", blocker };
  }
  if (source.action === "capture-node") {
    assertOnlyKeys(source, ["action", "id", "scope", "relation", "match", "index"], "capture-node step");
    if (!ID_PATTERN.test(source.id || "") || nodeIds.has(source.id) || !nodeIds.has(source.scope)) {
      throw new Error("Captured node ID or scope is invalid.");
    }
    if (!Number.isInteger(source.index) || source.index < 0 || source.index >= MAX_NODES) {
      throw new Error("Captured node index is invalid.");
    }
    const match = validateNodeMatch(source.match);
    const relation = validateRelation(source.relation);
    nodeIds.add(source.id);
    return { action: source.action, id: source.id, scope: source.scope, relation, match, index: source.index };
  }
  if (!nodeIds.has(source.target)) throw new Error("TestSpec step target is invalid.");
  if (source.action === "dispatch-event") {
    assertOnlyKeys(source, ["action", "target", "event", "init"], "dispatch-event step");
    if (!ALLOWED_EVENTS.has(source.event)) throw new Error("Dispatched event is not allowed.");
    return { action: source.action, target: source.target, event: source.event, init: validateEventInit(source.init || {}) };
  }
  if (source.action === "select-contents") {
    assertOnlyKeys(source, ["action", "target"], "select step");
    return { action: source.action, target: source.target };
  }
  if (source.action === "focus" || source.action === "remove-node") {
    assertOnlyKeys(source, ["action", "target"], `${source.action} step`);
    return { action: source.action, target: source.target };
  }
  if (source.action === "set-attribute") {
    assertOnlyKeys(source, ["action", "target", "name", "value"], "set-attribute step");
    const attributes = validateStringMap({ [source.name]: source.value }, ALLOWED_ATTRIBUTES, "attribute");
    return { action: source.action, target: source.target, name: source.name, value: attributes[source.name] };
  }
  if (source.action === "remove-attribute") {
    assertOnlyKeys(source, ["action", "target", "name"], "remove-attribute step");
    if (!ALLOWED_ATTRIBUTES.has(source.name)) throw new Error("Removed attribute is not allowed.");
    return { action: source.action, target: source.target, name: source.name };
  }
  if (source.action === "set-value") {
    assertOnlyKeys(source, ["action", "target", "value"], "set-value step");
    return { action: source.action, target: source.target, value: safeText(source.value, 500) };
  }
  assertOnlyKeys(source, ["action", "target", "property", "value"], "set-style step");
  if (!ALLOWED_STYLES.has(source.property)) throw new Error("Style property is not allowed.");
  return { action: source.action, target: source.target, property: source.property, value: safeStyleValue(source.value) };
}

function validateAssertion(source, nodeIds, blockerIds, stepCount) {
  assertRecord(source, "assertion");
  if (!ALLOWED_ASSERTIONS.has(source.type)) throw new Error("TestSpec assertion is not allowed.");
  const common = { type: source.type };
  if (source.type === "event-default-prevented") {
    assertOnlyKeys(source, ["type", "step", "expected"], "event assertion");
    if (!Number.isInteger(source.step) || source.step < 0 || source.step >= stepCount || typeof source.expected !== "boolean") {
      throw new Error("Event assertion is invalid.");
    }
    return { ...common, step: source.step, expected: source.expected };
  }
  if (source.type === "blocker-call-count") {
    assertOnlyKeys(source, ["type", "blocker", "operator", "value"], "blocker assertion");
    if (!blockerIds.has(source.blocker) || !["eq", "gte"].includes(source.operator) || !Number.isInteger(source.value)) {
      throw new Error("Blocker assertion is invalid.");
    }
    return { ...common, blocker: source.blocker, operator: source.operator, value: source.value };
  }
  if (source.type === "selection-collapsed") {
    assertOnlyKeys(source, ["type", "expected"], "selection assertion");
    if (typeof source.expected !== "boolean") throw new Error("Selection assertion is invalid.");
    return { ...common, expected: source.expected };
  }
  if (source.type === "node-count") {
    assertOnlyKeys(source, ["type", "scope", "relation", "match", "operator", "value"], "node-count assertion");
    if (!nodeIds.has(source.scope) || !["eq", "gte"].includes(source.operator) || !Number.isInteger(source.value) || source.value < 0) {
      throw new Error("Node-count assertion is invalid.");
    }
    return {
      ...common,
      scope: source.scope,
      relation: validateRelation(source.relation),
      match: validateNodeMatch(source.match),
      operator: source.operator,
      value: source.value
    };
  }
  if (!nodeIds.has(source.target)) throw new Error("Assertion target is invalid.");
  if (source.type === "dom-present") {
    assertOnlyKeys(source, ["type", "target", "expected"], "DOM assertion");
    if (typeof source.expected !== "boolean") throw new Error("DOM assertion is invalid.");
    return { ...common, target: source.target, expected: source.expected };
  }
  if (source.type === "computed-style") {
    assertOnlyKeys(source, ["type", "target", "property", "pseudo", "operator", "value"], "style assertion");
    if (!ALLOWED_STYLES.has(source.property) || !["eq", "neq", "contains"].includes(source.operator)) {
      throw new Error("Computed-style assertion is invalid.");
    }
    if (source.pseudo != null && source.pseudo !== "::selection") throw new Error("Computed-style pseudo-element is invalid.");
    return {
      ...common,
      target: source.target,
      property: source.property,
      pseudo: source.pseudo || null,
      operator: source.operator,
      value: safeStyleValue(source.value)
    };
  }
  if (source.type === "value") {
    assertOnlyKeys(source, ["type", "target", "operator", "value"], "value assertion");
    if (!["eq", "neq", "contains"].includes(source.operator)) throw new Error("Value assertion is invalid.");
    return { ...common, target: source.target, operator: source.operator, value: safeText(source.value, 500) };
  }
  if (source.type === "text-content") {
    assertOnlyKeys(source, ["type", "target", "operator", "value"], "text assertion");
    if (!["eq", "neq", "contains"].includes(source.operator)) throw new Error("Text assertion is invalid.");
    return { ...common, target: source.target, operator: source.operator, value: safeText(source.value, 500) };
  }
  assertOnlyKeys(source, ["type", "target", "name", "operator", "value"], "attribute assertion");
  if (!ALLOWED_ATTRIBUTES.has(source.name) || !["exists", "absent", "eq"].includes(source.operator)) {
    throw new Error("Attribute assertion is invalid.");
  }
  return { ...common, target: source.target, name: source.name, operator: source.operator, value: safeText(source.value || "", 500) };
}

function validateStringMap(value, allowlist, label) {
  if (value == null) return {};
  assertRecord(value, `${label} map`);
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowlist.has(key) && !(label === "attribute" && /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))) {
      throw new Error(`Fixture ${label} is not allowed.`);
    }
    const safe = label === "style" ? safeStyleValue(raw) : safeText(raw, 500);
    if (key === "href" && !safe.startsWith("#")) throw new Error("Fixture links must use local fragment URLs.");
    output[key] = safe;
  }
  return output;
}

function validateNodeMatch(value) {
  assertRecord(value, "node match");
  assertOnlyKeys(value, ["tag", "attribute", "text"], "node match");
  if (value.tag == null && value.attribute == null && value.text == null) throw new Error("Node match cannot be empty.");
  const output = {};
  if (value.tag != null) {
    if (value.tag !== "*" && !ALLOWED_TAGS.has(value.tag)) throw new Error("Node-match tag is invalid.");
    output.tag = value.tag;
  }
  if (value.attribute != null) {
    assertRecord(value.attribute, "node-match attribute");
    assertOnlyKeys(value.attribute, ["name", "operator", "value"], "node-match attribute");
    const validated = validateStringMap({ [value.attribute.name]: value.attribute.value || "" }, ALLOWED_ATTRIBUTES, "attribute");
    if (!["exists", "absent", "eq", "contains"].includes(value.attribute.operator)) throw new Error("Node-match attribute operator is invalid.");
    output.attribute = {
      name: value.attribute.name,
      operator: value.attribute.operator,
      value: validated[value.attribute.name]
    };
  }
  if (value.text != null) {
    assertRecord(value.text, "node-match text");
    assertOnlyKeys(value.text, ["operator", "value"], "node-match text");
    if (!["eq", "contains"].includes(value.text.operator)) throw new Error("Node-match text operator is invalid.");
    output.text = { operator: value.text.operator, value: safeText(value.text.value, 500) };
  }
  return output;
}

function validateRelation(value) {
  if (!["descendant", "self-or-descendant"].includes(value)) throw new Error("Node-query relation is invalid.");
  return value;
}

function validateEventInit(value) {
  assertRecord(value, "event init");
  assertOnlyKeys(value, ["button", "key", "ctrlKey", "metaKey", "shiftKey", "inputType", "data"], "event init");
  const output = {};
  if (value.button != null) {
    if (!Number.isInteger(value.button) || value.button < 0 || value.button > 2) throw new Error("Event button is invalid.");
    output.button = value.button;
  }
  if (value.key != null) output.key = safeText(value.key, 30);
  for (const key of ["ctrlKey", "metaKey", "shiftKey"]) {
    if (value[key] != null) {
      if (typeof value[key] !== "boolean") throw new Error("Event modifier is invalid.");
      output[key] = value[key];
    }
  }
  if (value.inputType != null) output.inputType = safeText(value.inputType, 50);
  if (value.data != null) output.data = safeText(value.data, 500);
  return output;
}

function boundedArray(value, label, allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > MAX_ITEMS) {
    throw new Error(`TestSpec ${label} has an invalid length.`);
  }
  return value;
}

function safeStyleValue(value) {
  const text = safeText(value, 200);
  if (/url\s*\(|expression\s*\(|@import|javascript:|data:/i.test(text)) throw new Error("Style value may load or execute content.");
  return text;
}

function safeText(value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error("TestSpec string value is invalid.");
  return value;
}

function assertOnlyKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(`${label} contains unsupported fields.`);
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}
