const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_TESTS = 40;
const MAX_NODES = 30;
const MAX_ITEMS = 40;
const ALLOWED_TAGS = new Set([
  "a", "article", "aside", "button", "canvas", "details", "dialog", "div", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "img", "input", "label", "li", "main",
  "nav", "ol", "option", "p", "section", "select", "span", "summary", "table", "tbody", "td",
  "textarea", "th", "thead", "tr", "ul", "video"
]);
const ALLOWED_ATTRIBUTES = new Set([
  "alt", "checked", "class", "contenteditable", "disabled", "href", "max", "maxlength", "min",
  "minlength", "multiple", "name", "placeholder", "readonly", "required", "role", "selected", "tabindex",
  "title", "type", "unselectable", "value"
]);
const ALLOWED_STYLES = new Set([
  "alignItems", "backgroundColor", "backgroundImage", "borderBottomColor", "borderBottomWidth",
  "borderLeftColor", "borderLeftWidth", "borderRadius", "borderRightColor", "borderRightWidth",
  "borderTopColor", "borderTopWidth", "boxShadow", "boxSizing", "color", "cursor", "display", "flexDirection",
  "flexGrow", "flexShrink", "fontFamily", "fontSize", "fontStyle", "fontWeight", "gap", "gridTemplateColumns",
  "height", "inset", "justifyContent", "left", "letterSpacing", "lineHeight", "marginBottom", "marginLeft",
  "marginRight", "marginTop", "maxHeight", "maxWidth", "minHeight", "minWidth", "opacity", "overflow",
  "overflowX", "overflowY", "paddingBottom", "paddingLeft", "paddingRight", "paddingTop", "pointerEvents",
  "position", "right", "textAlign", "textDecoration", "top", "transform", "userSelect", "verticalAlign",
  "visibility", "whiteSpace", "width", "wordBreak", "zIndex"
]);
const ALLOWED_EVENTS = new Set([
  "beforeinput", "blur", "change", "click", "contextmenu", "copy", "cut", "dblclick", "dragend", "dragstart",
  "focus", "input", "keydown", "keyup", "mousedown", "mouseenter", "mouseleave", "mousemove", "mouseup",
  "paste", "pointerdown", "pointermove", "pointerup", "scroll", "selectstart", "submit", "touchend", "wheel"
]);
const ALLOWED_EFFECTS = new Set([
  "clear-selection", "flag-only", "prevent-default", "prevent-default-and-stop", "return-false", "rollback-value"
]);
const ALLOWED_ACTIONS = new Set([
  "add-blocker", "append-node", "blur", "capture-node", "click", "click-control", "click-page", "copy-shortcut", "dispatch-event", "focus", "remove-attribute", "remove-node",
  "drag-select-text", "mutation-burst", "paste-text", "scroll", "scroll-page", "scroll-stress", "select-contents", "set-attribute", "set-checked", "set-style", "set-text", "set-value", "wait"
]);
const ALLOWED_ASSERTIONS = new Set([
  "active-element", "attribute", "attribute-refers-to", "blocker-call-count", "bounding-rect", "computed-style", "contrast-ratio",
  "dom-present", "event-default-prevented", "hit-test", "node-count", "property", "relative-position",
  "scroll-offset", "selection-collapsed", "step-duration", "text-content", "value", "visible"
]);
export const FAILURE_CATEGORIES = Object.freeze([
  "accessibility-state", "attribute-state", "blocker-state", "computed-style", "dom-state", "event-state",
  "focus-state", "layout-state", "performance-state", "policy-state", "property-state", "selection-state", "value-state", "visibility-state"
]);

export const SECURITY_VERDICTS = Object.freeze(["allow", "reject", "unverifiable"]);
export const SECURITY_REASON_CODES = Object.freeze([
  "safe-declarative-behavior",
  "instruction-override",
  "validation-bypass",
  "hidden-behavior",
  "undeclared-capability",
  "sensitive-data-access",
  "external-communication",
  "unverifiable-capability"
]);

export function parseTesterSecurityReview(text, skill, criteria) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let review;
  try {
    review = JSON.parse(cleaned);
  } catch {
    throw new Error("Tester LLM did not return valid JSON.");
  }
  return validateTesterSecurityReview(review, skill, criteria);
}

export function validateTesterSecurityReview(review, skill, criteria) {
  assertRecord(review, "Tester security review");
  assertOnlyKeys(review, ["schemaVersion", "verdict", "reasonCodes", "testSpec"], "Tester security review");
  if (review.schemaVersion !== 1 || !SECURITY_VERDICTS.includes(review.verdict)) {
    throw new Error("Tester LLM returned an unsupported security-review schema.");
  }
  if (!Array.isArray(review.reasonCodes) || review.reasonCodes.length === 0 || review.reasonCodes.length > 8
    || review.reasonCodes.some(code => !SECURITY_REASON_CODES.includes(code))) {
    throw new Error("Tester security review contains invalid reason codes.");
  }
  const reasonCodes = [...new Set(review.reasonCodes)];
  if (review.verdict === "allow") {
    if (reasonCodes.length !== 1 || reasonCodes[0] !== "safe-declarative-behavior" || !review.testSpec) {
      throw new Error("An allowed MSkill requires a complete Independent TestSpec.");
    }
    return {
      schemaVersion: 1,
      verdict: "allow",
      reasonCodes,
      testSpec: validateTestSpec(review.testSpec, skill, criteria)
    };
  }
  if (review.testSpec !== null) throw new Error("Rejected or unverifiable MSkills must not include a TestSpec.");
  if (reasonCodes.includes("safe-declarative-behavior")) {
    throw new Error("A blocked MSkill cannot be marked as safe declarative behavior.");
  }
  if (review.verdict === "unverifiable" && !reasonCodes.includes("unverifiable-capability")) {
    throw new Error("An unverifiable MSkill requires the unverifiable-capability reason code.");
  }
  if (review.verdict === "reject" && reasonCodes.includes("unverifiable-capability")) {
    throw new Error("Use the unverifiable verdict when the Runner cannot enforce a required capability.");
  }
  return { schemaVersion: 1, verdict: review.verdict, reasonCodes, testSpec: null };
}

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
  validateWorkflowCoverage(blockers, steps);
  const blockerMetadata = new Map(blockers.map(blocker => [blocker.id, {
    effect: blocker.effect,
    event: blocker.event
  }]));
  for (const step of steps) {
    if (step.action === "add-blocker") {
      blockerMetadata.set(step.blocker.id, {
        effect: step.blocker.effect,
        event: step.blocker.event
      });
    }
  }
  const assertions = boundedArray(source.assertions, "assertions", false).map(assertion => (
    validateAssertion(assertion, nodeIds, blockerMetadata, steps)
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
    assertOnlyKeys(node, ["id", "tag", "parent", "text", "attributes", "styles", "rect"], "fixture node");
    if (!ID_PATTERN.test(node.id || "") || ids.has(node.id)) throw new Error("Fixture node ID is invalid or duplicated.");
    if (!ALLOWED_TAGS.has(node.tag)) throw new Error("Fixture uses a disallowed HTML tag.");
    if (node.parent && !ids.has(node.parent)) throw new Error("Fixture parent must refer to an earlier node.");
    ids.add(node.id);
    const normalized = {
      id: node.id,
      tag: node.tag,
      parent: node.parent || null,
      text: safeText(node.text || "", 500),
      attributes: validateStringMap(node.attributes, ALLOWED_ATTRIBUTES, "attribute"),
      styles: validateStringMap(node.styles, ALLOWED_STYLES, "style")
    };
    if (node.rect != null) normalized.rect = validateFixtureRect(node.rect);
    return normalized;
  });
  const rules = boundedArray(source.rules || [], "fixture rules").map(rule => {
    assertRecord(rule, "fixture rule");
    assertOnlyKeys(rule, ["target", "pseudo", "styles", "specificity"], "fixture rule");
    if (!ids.has(rule.target) || rule.pseudo !== "::selection") throw new Error("Fixture rule target or pseudo-element is invalid.");
    if (rule.specificity != null && rule.specificity !== "id-ancestor") {
      throw new Error("Fixture rule specificity is invalid.");
    }
    return {
      target: rule.target,
      pseudo: rule.pseudo,
      styles: validateStringMap(rule.styles, ALLOWED_STYLES, "style"),
      specificity: rule.specificity || "normal"
    };
  });
  return { nodes, rules };
}

function validateBlocker(source, nodeIds) {
  assertRecord(source, "blocker");
  assertOnlyKeys(source, ["id", "target", "event", "registration", "effect", "when"], "blocker");
  if (!ID_PATTERN.test(source.id || "") || !nodeIds.has(source.target)) throw new Error("Blocker ID or target is invalid.");
  if (!ALLOWED_EVENTS.has(source.event)) throw new Error("Blocker event is not allowed.");
  if (!["listener", "inline", "property"].includes(source.registration) || !ALLOWED_EFFECTS.has(source.effect)) {
    throw new Error("Blocker registration or effect is not allowed.");
  }
  if (source.effect === "return-false" && source.registration === "listener") {
    throw new Error("return-false requires an inline or property event handler.");
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
    if (!Number.isInteger(source.ms) || source.ms < 0 || source.ms > 2000) throw new Error("Wait duration is invalid.");
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
  if (source.action === "scroll-page") {
    assertOnlyKeys(source, ["action", "left", "top"], "scroll-page step");
    return {
      action: source.action,
      left: safeFiniteNumber(source.left, -10000, 10000, "Page scroll offset"),
      top: safeFiniteNumber(source.top, -10000, 10000, "Page scroll offset")
    };
  }
  if (source.action === "mutation-burst") {
    assertOnlyKeys(source, ["action", "target", "count", "batchSize"], "mutation-burst step");
    if (!nodeIds.has(source.target)
      || !Number.isInteger(source.count) || source.count < 20 || source.count > 500
      || !Number.isInteger(source.batchSize) || source.batchSize < 1 || source.batchSize > 50
      || source.count % source.batchSize !== 0) {
      throw new Error("Mutation burst is invalid.");
    }
    return { action: source.action, target: source.target, count: source.count, batchSize: source.batchSize };
  }
  if (source.action === "scroll-stress") {
    assertOnlyKeys(source, ["action", "target", "count", "iterations"], "scroll-stress step");
    if (!nodeIds.has(source.target)
      || !Number.isInteger(source.count) || source.count < 100 || source.count > 500
      || !Number.isInteger(source.iterations) || source.iterations < 2 || source.iterations > 20) {
      throw new Error("Scroll stress is invalid.");
    }
    return { action: source.action, target: source.target, count: source.count, iterations: source.iterations };
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
  if (source.action === "drag-select-text") {
    assertOnlyKeys(source, ["action", "target"], "drag-select-text step");
    return { action: source.action, target: source.target };
  }
  if (source.action === "paste-text") {
    assertOnlyKeys(source, ["action", "target", "value"], "paste-text step");
    return { action: source.action, target: source.target, value: safeText(source.value, 500) };
  }
  if (source.action === "copy-shortcut") {
    assertOnlyKeys(source, ["action", "target", "operation"], "copy-shortcut step");
    if (!["copy", "cut"].includes(source.operation)) throw new Error("copy-shortcut operation is invalid.");
    return { action: source.action, target: source.target, operation: source.operation };
  }
  if (["click-control", "click-page"].includes(source.action)) {
    assertOnlyKeys(source, ["action", "target"], `${source.action} step`);
    return { action: source.action, target: source.target };
  }
  if (["blur", "click", "focus", "remove-node"].includes(source.action)) {
    assertOnlyKeys(source, ["action", "target"], `${source.action} step`);
    return { action: source.action, target: source.target };
  }
  if (source.action === "scroll") {
    assertOnlyKeys(source, ["action", "target", "left", "top"], "scroll step");
    return {
      action: source.action,
      target: source.target,
      left: safeFiniteNumber(source.left, -10000, 10000, "Scroll offset"),
      top: safeFiniteNumber(source.top, -10000, 10000, "Scroll offset")
    };
  }
  if (source.action === "set-attribute") {
    assertOnlyKeys(source, ["action", "target", "name", "value"], "set-attribute step");
    const attributes = validateStringMap({ [source.name]: source.value }, ALLOWED_ATTRIBUTES, "attribute");
    return { action: source.action, target: source.target, name: source.name, value: attributes[source.name] };
  }
  if (source.action === "remove-attribute") {
    assertOnlyKeys(source, ["action", "target", "name"], "remove-attribute step");
    if (!isAllowedAttribute(source.name)) throw new Error("Removed attribute is not allowed.");
    return { action: source.action, target: source.target, name: source.name };
  }
  if (source.action === "set-value") {
    assertOnlyKeys(source, ["action", "target", "value"], "set-value step");
    return { action: source.action, target: source.target, value: safeText(source.value, 500) };
  }
  if (source.action === "set-text") {
    assertOnlyKeys(source, ["action", "target", "value"], "set-text step");
    return { action: source.action, target: source.target, value: safeText(source.value, 500) };
  }
  if (source.action === "set-checked") {
    assertOnlyKeys(source, ["action", "target", "value"], "set-checked step");
    if (typeof source.value !== "boolean") throw new Error("Checked state is invalid.");
    return { action: source.action, target: source.target, value: source.value };
  }
  assertOnlyKeys(source, ["action", "target", "property", "value"], "set-style step");
  if (!ALLOWED_STYLES.has(source.property)) throw new Error("Style property is not allowed.");
  return { action: source.action, target: source.target, property: source.property, value: safeStyleValue(source.value) };
}

function validateWorkflowCoverage(blockers, steps) {
  const actions = new Set(steps.map(step => step.action));
  const modelsPaste = blockers.some(blocker => (
    blocker.event === "paste"
    || blocker.event === "beforeinput" && blocker.when.inputType === "insertFromPaste"
    || blocker.event === "input" && (blocker.effect === "rollback-value" || blocker.when.inputType === "insertFromPaste")
  ));
  if (modelsPaste && !actions.has("paste-text")) {
    throw new Error("Paste blockers require the paste-text workflow action.");
  }
  const modelsSelection = blockers.some(blocker => blocker.event === "selectstart" || blocker.effect === "clear-selection");
  if (modelsSelection && !actions.has("drag-select-text")) {
    throw new Error("Selection blockers require the drag-select-text workflow action.");
  }
  const modelsCopyShortcut = blockers.some(blocker => (
    blocker.event === "copy" || blocker.event === "cut"
    || blocker.event === "keydown" && ["c", "x"].includes(String(blocker.when.key || "").toLowerCase())
  ));
  if (modelsCopyShortcut && !actions.has("copy-shortcut")) {
    throw new Error("Copy/cut shortcut blockers require the copy-shortcut workflow action.");
  }
}

function validateAssertion(source, nodeIds, blockerMetadata, steps) {
  const stepCount = steps.length;
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
    if (!blockerMetadata.has(source.blocker) || !["eq", "gte"].includes(source.operator) || !Number.isInteger(source.value)) {
      throw new Error("Blocker assertion is invalid.");
    }
    const blocker = blockerMetadata.get(source.blocker);
    if (["copy", "cut"].includes(blocker.event)) {
      throw new Error("Copy/cut success must use the trusted copy-shortcut result and observable value state, not a page handler call count.");
    }
    if (source.operator === "eq" && source.value === 0 && blocker.effect !== "flag-only") {
      throw new Error("Zero call-count assertions require a flag-only blocker; assert the observable outcome of effectful blockers.");
    }
    return { ...common, blocker: source.blocker, operator: source.operator, value: source.value };
  }
  if (source.type === "selection-collapsed") {
    assertOnlyKeys(source, ["type", "expected"], "selection assertion");
    if (typeof source.expected !== "boolean") throw new Error("Selection assertion is invalid.");
    return { ...common, expected: source.expected };
  }
  if (source.type === "step-duration") {
    assertOnlyKeys(source, ["type", "step", "operator", "value"], "step-duration assertion");
    if (!Number.isInteger(source.step) || source.step < 0 || source.step >= stepCount
      || !["mutation-burst", "scroll-stress"].includes(steps[source.step]?.action)
      || !["lt", "lte"].includes(source.operator)
      || !Number.isInteger(source.value) || source.value < 50 || source.value > 4000) {
      throw new Error("Step-duration assertion is invalid.");
    }
    return { ...common, step: source.step, operator: source.operator, value: source.value };
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
  if (source.type === "active-element" || source.type === "visible" || source.type === "hit-test") {
    assertOnlyKeys(source, ["type", "target", "expected", "point"], `${source.type} assertion`);
    if (typeof source.expected !== "boolean") throw new Error(`${source.type} assertion is invalid.`);
    if (source.type !== "hit-test" && source.point != null) throw new Error(`${source.type} assertion contains an unsupported point.`);
    const point = source.type === "hit-test" ? validateHitPoint(source.point || "center") : undefined;
    return { ...common, target: source.target, expected: source.expected, ...(point ? { point } : {}) };
  }
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
    if (source.pseudo != null && !["::selection", "::before", "::after"].includes(source.pseudo)) {
      throw new Error("Computed-style pseudo-element is invalid.");
    }
    if (source.property === "pointerEvents") {
      throw new Error("Pointer reachability must use a hit-test assertion, not implementation-specific pointerEvents style.");
    }
    return {
      ...common,
      target: source.target,
      property: source.property,
      pseudo: source.pseudo || null,
      operator: source.operator,
      value: safeStyleValue(source.value)
    };
  }
  if (source.type === "bounding-rect") {
    assertOnlyKeys(source, ["type", "target", "property", "operator", "value", "tolerance"], "bounding-rect assertion");
    if (!["x", "y", "top", "right", "bottom", "left", "width", "height"].includes(source.property)) {
      throw new Error("Bounding-rect property is invalid.");
    }
    return {
      ...common,
      target: source.target,
      property: source.property,
      operator: validateNumericOperator(source.operator),
      value: safeFiniteNumber(source.value, -100000, 100000, "Bounding-rect value"),
      tolerance: safeTolerance(source.tolerance)
    };
  }
  if (source.type === "relative-position") {
    assertOnlyKeys(source, ["type", "target", "other", "relation", "tolerance"], "relative-position assertion");
    if (!nodeIds.has(source.other) || !["above", "below", "left-of", "right-of", "inside", "overlaps", "not-overlaps", "aligned-x", "aligned-y"].includes(source.relation)) {
      throw new Error("Relative-position assertion is invalid.");
    }
    return { ...common, target: source.target, other: source.other, relation: source.relation, tolerance: safeTolerance(source.tolerance) };
  }
  if (source.type === "contrast-ratio") {
    assertOnlyKeys(source, ["type", "target", "operator", "value"], "contrast assertion");
    return {
      ...common,
      target: source.target,
      operator: validateNumericOperator(source.operator, false),
      value: safeFiniteNumber(source.value, 1, 21, "Contrast ratio")
    };
  }
  if (source.type === "scroll-offset") {
    assertOnlyKeys(source, ["type", "target", "axis", "operator", "value", "tolerance"], "scroll assertion");
    if (!["left", "top"].includes(source.axis)) throw new Error("Scroll axis is invalid.");
    return {
      ...common,
      target: source.target,
      axis: source.axis,
      operator: validateNumericOperator(source.operator),
      value: safeFiniteNumber(source.value, -10000, 10000, "Scroll value"),
      tolerance: safeTolerance(source.tolerance)
    };
  }
  if (source.type === "property") {
    assertOnlyKeys(source, ["type", "target", "name", "expected"], "property assertion");
    if (!["checked", "disabled", "readOnly", "required", "selected", "open"].includes(source.name) || typeof source.expected !== "boolean") {
      throw new Error("Property assertion is invalid.");
    }
    return { ...common, target: source.target, name: source.name, expected: source.expected };
  }
  if (source.type === "attribute-refers-to") {
    assertOnlyKeys(source, ["type", "target", "name", "other", "expected"], "attribute-reference assertion");
    if (!isAllowedAttribute(source.name) || !nodeIds.has(source.other) || typeof source.expected !== "boolean") {
      throw new Error("Attribute-reference assertion is invalid.");
    }
    return { ...common, target: source.target, name: source.name, other: source.other, expected: source.expected };
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
  if (!isAllowedAttribute(source.name) || !["exists", "absent", "eq", "contains"].includes(source.operator)) {
    throw new Error("Attribute assertion is invalid.");
  }
  return { ...common, target: source.target, name: source.name, operator: source.operator, value: safeText(source.value || "", 500) };
}

function validateStringMap(value, allowlist, label) {
  if (value == null) return {};
  assertRecord(value, `${label} map`);
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowlist.has(key) && !(label === "attribute" && isAllowedAttribute(key))) {
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

function isAllowedAttribute(name) {
  return ALLOWED_ATTRIBUTES.has(name)
    || /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name || "")
    || /^aria-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name || "");
}

function validateNumericOperator(value, allowApprox = true) {
  const allowed = allowApprox ? ["eq", "neq", "gt", "gte", "lt", "lte", "approx"] : ["eq", "neq", "gt", "gte", "lt", "lte"];
  if (!allowed.includes(value)) throw new Error("Numeric comparison operator is invalid.");
  return value;
}

function safeTolerance(value) {
  return value == null ? 0 : safeFiniteNumber(value, 0, 1000, "Comparison tolerance");
}

function safeFiniteNumber(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateFixtureRect(value) {
  assertRecord(value, "fixture rectangle");
  assertOnlyKeys(value, ["x", "y", "width", "height"], "fixture rectangle");
  return {
    x: safeFiniteNumber(value.x, -10000, 10000, "Fixture rectangle x"),
    y: safeFiniteNumber(value.y, -10000, 10000, "Fixture rectangle y"),
    width: safeFiniteNumber(value.width, 0, 10000, "Fixture rectangle width"),
    height: safeFiniteNumber(value.height, 0, 10000, "Fixture rectangle height")
  };
}

function validateHitPoint(value) {
  if (!["center", "top-left", "top-right", "bottom-left", "bottom-right"].includes(value)) {
    throw new Error("Hit-test point is invalid.");
  }
  return value;
}

function validateEventInit(value) {
  assertRecord(value, "event init");
  assertOnlyKeys(value, ["button", "buttons", "key", "code", "ctrlKey", "metaKey", "shiftKey", "altKey", "inputType", "data", "clientX", "clientY", "deltaX", "deltaY"], "event init");
  const output = {};
  if (value.button != null) {
    if (!Number.isInteger(value.button) || value.button < 0 || value.button > 2) throw new Error("Event button is invalid.");
    output.button = value.button;
  }
  if (value.buttons != null) {
    if (!Number.isInteger(value.buttons) || value.buttons < 0 || value.buttons > 7) throw new Error("Event buttons value is invalid.");
    output.buttons = value.buttons;
  }
  if (value.key != null) output.key = safeText(value.key, 30);
  if (value.code != null) output.code = safeText(value.code, 30);
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    if (value[key] != null) {
      if (typeof value[key] !== "boolean") throw new Error("Event modifier is invalid.");
      output[key] = value[key];
    }
  }
  if (value.inputType != null) output.inputType = safeText(value.inputType, 50);
  if (value.data != null) output.data = safeText(value.data, 500);
  for (const key of ["clientX", "clientY", "deltaX", "deltaY"]) {
    if (value[key] != null) output[key] = safeFiniteNumber(value[key], -10000, 10000, "Event coordinate");
  }
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
  if (/[{};]/.test(text) || /!important|url\s*\(|expression\s*\(|@import|javascript:|data:/i.test(text)) {
    throw new Error("Style value may escape, load, or execute content.");
  }
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
