(() => {
  const nonce = crypto.randomUUID();
  const nativeEval = eval;

  window.addEventListener("message", async event => {
    const message = event.data;
    if (event.source !== parent || message?.type !== "monkeyskill-run-test" || message.nonce !== nonce) return;
    let result;
    try {
      installArtifact(message.artifact);
      result = await executeTest(message.test);
    } catch {
      result = { ok: false, category: "dom-state" };
    }
    parent.postMessage({ type: "monkeyskill-test-result", nonce, result }, "*");
  }, { once: true });

  parent.postMessage({ type: "monkeyskill-sandbox-ready", nonce }, "*");

  function installArtifact(artifact) {
    if (artifact.css) {
      const style = document.createElement("style");
      style.textContent = artifact.css;
      document.head.append(style);
    }
    (0, nativeEval)(`${artifact.js}\n//# sourceURL=monkeyskill-generated-build.js`);
  }

  async function executeTest(test) {
    const state = {
      nodes: new Map(),
      blockerCalls: new Map(),
      inlineBlockers: new Map(),
      stepResults: []
    };
    createFixture(test.fixture, state);
    installBlockers(test.blockers, state);
    await settle();
    for (const step of test.steps) state.stepResults.push(await executeStep(step, state));
    for (const assertion of test.assertions) {
      if (!evaluateAssertion(assertion, state)) {
        return { ok: false, category: assertionCategory(assertion.type) };
      }
    }
    return { ok: true, category: "dom-state" };
  }

  function createFixture(fixture, state) {
    const root = document.querySelector("#fixture");
    root.replaceChildren();
    for (const node of fixture.nodes) createNode(node, state, root);
    for (const rule of fixture.rules) {
      const style = document.createElement("style");
      const declarations = Object.entries(rule.styles)
        .map(([property, value]) => `${toCssProperty(property)}:${value}!important`)
        .join(";");
      style.textContent = `#${CSS.escape(rule.target)}${rule.pseudo}{${declarations}}`;
      document.head.append(style);
    }
  }

  function createNode(node, state, root) {
    const element = document.createElement(node.tag);
    element.id = node.id;
    if (node.text) element.textContent = node.text;
    for (const [name, value] of Object.entries(node.attributes)) element.setAttribute(name, value);
    for (const [property, value] of Object.entries(node.styles)) element.style[property] = value;
    const parentNode = node.parent ? state.nodes.get(node.parent) : root;
    if (!parentNode) throw new Error("Fixture parent missing.");
    parentNode.append(element);
    state.nodes.set(node.id, element);
    return element;
  }

  function installBlockers(blockers, state) {
    globalThis.__monkeySkillTestInlineBlocker = (id, event) => {
      const blocker = state.inlineBlockers.get(id);
      if (!blocker || !matchesWhen(event, blocker.when)) return true;
      applyEffect(blocker, event, state);
      return !event.defaultPrevented;
    };
    for (const blocker of blockers) installBlocker(blocker, state);
  }

  function installBlocker(blocker, state) {
    const target = state.nodes.get(blocker.target);
    if (!target) throw new Error("Blocker target missing.");
    state.blockerCalls.set(blocker.id, 0);
    const initialValue = "value" in target ? target.value : "";
    const installed = { ...blocker, initialValue };
    if (blocker.registration === "inline") {
      state.inlineBlockers.set(blocker.id, installed);
      target.setAttribute(`on${blocker.event}`, `return globalThis.__monkeySkillTestInlineBlocker(${JSON.stringify(blocker.id)}, event)`);
    } else {
      target.addEventListener(blocker.event, event => {
        if (!matchesWhen(event, blocker.when)) return;
        applyEffect(installed, event, state);
      });
    }
  }

  function applyEffect(blocker, event, state) {
    state.blockerCalls.set(blocker.id, (state.blockerCalls.get(blocker.id) || 0) + 1);
    if (blocker.effect === "prevent-default" || blocker.effect === "prevent-default-and-stop") event.preventDefault();
    if (blocker.effect === "prevent-default-and-stop") event.stopImmediatePropagation();
    if (blocker.effect === "clear-selection") getSelection()?.removeAllRanges();
    if (blocker.effect === "rollback-value" && "value" in event.target) event.target.value = blocker.initialValue || "";
  }

  async function executeStep(step, state) {
    if (step.action === "wait") {
      await new Promise(resolve => setTimeout(resolve, step.ms));
      return null;
    }
    if (step.action === "append-node") {
      createNode(step.node, state, document.querySelector("#fixture"));
      await settle();
      return null;
    }
    if (step.action === "add-blocker") {
      installBlocker(step.blocker, state);
      await settle();
      return null;
    }
    if (step.action === "capture-node") {
      const scope = state.nodes.get(step.scope);
      const captured = queryNodes(scope, step.relation, step.match)[step.index];
      if (captured) state.nodes.set(step.id, captured);
      return null;
    }
    const target = state.nodes.get(step.target);
    if (!target) throw new Error("Step target missing.");
    if (step.action === "select-contents") {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return null;
    }
    if (step.action === "focus") {
      target.focus();
      return null;
    }
    if (step.action === "remove-node") {
      target.remove();
      await settle();
      return null;
    }
    if (step.action === "set-attribute") {
      target.setAttribute(step.name, step.value);
      await settle();
      return null;
    }
    if (step.action === "remove-attribute") {
      target.removeAttribute(step.name);
      await settle();
      return null;
    }
    if (step.action === "set-value") {
      target.value = step.value;
      return null;
    }
    if (step.action === "set-style") {
      target.style[step.property] = step.value;
      await settle();
      return null;
    }
    const event = createEvent(step.event, step.init);
    target.dispatchEvent(event);
    await settle();
    return { defaultPrevented: event.defaultPrevented };
  }

  function createEvent(type, init) {
    const options = { bubbles: true, cancelable: true, ...init };
    if (type === "keydown" || type === "keyup") return new KeyboardEvent(type, options);
    if (type === "input") return new InputEvent(type, options);
    if (["click", "contextmenu", "mousedown", "mouseup"].includes(type)) return new MouseEvent(type, options);
    return new Event(type, options);
  }

  function evaluateAssertion(assertion, state) {
    if (assertion.type === "event-default-prevented") {
      return state.stepResults[assertion.step]?.defaultPrevented === assertion.expected;
    }
    if (assertion.type === "blocker-call-count") {
      return compare(state.blockerCalls.get(assertion.blocker) || 0, assertion.operator, assertion.value);
    }
    if (assertion.type === "selection-collapsed") return Boolean(getSelection()?.isCollapsed) === assertion.expected;
    if (assertion.type === "node-count") {
      const scope = state.nodes.get(assertion.scope);
      return compare(queryNodes(scope, assertion.relation, assertion.match).length, assertion.operator, assertion.value);
    }
    const target = state.nodes.get(assertion.target);
    if (assertion.type === "dom-present") return Boolean(target?.isConnected) === assertion.expected;
    if (!target) return false;
    if (assertion.type === "computed-style") {
      return compare(getComputedStyle(target, assertion.pseudo)[assertion.property], assertion.operator, assertion.value);
    }
    if (assertion.type === "value") return compare(target.value, assertion.operator, assertion.value);
    if (assertion.type === "text-content") return compare(target.textContent, assertion.operator, assertion.value);
    const present = target.hasAttribute(assertion.name);
    if (assertion.operator === "exists") return present;
    if (assertion.operator === "absent") return !present;
    return present && target.getAttribute(assertion.name) === assertion.value;
  }

  function compare(actual, operator, expected) {
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    if (operator === "contains") return String(actual).includes(String(expected));
    if (operator === "gte") return Number(actual) >= Number(expected);
    return false;
  }

  function assertionCategory(type) {
    if (type === "event-default-prevented") return "event-state";
    if (type === "blocker-call-count") return "blocker-state";
    if (type === "computed-style") return "computed-style";
    if (type === "selection-collapsed") return "selection-state";
    if (type === "value") return "value-state";
    if (type === "text-content") return "value-state";
    if (type === "attribute") return "attribute-state";
    return "dom-state";
  }

  function matchesWhen(event, when) {
    for (const [key, value] of Object.entries(when)) {
      if (event[key] !== value) return false;
    }
    return true;
  }

  function queryNodes(scope, relation, match) {
    if (!scope) return [];
    const nodes = relation === "self-or-descendant" ? [scope, ...scope.querySelectorAll("*")] : [...scope.querySelectorAll("*")];
    return nodes.filter(node => matchesNode(node, match));
  }

  function matchesNode(node, match) {
    if (match.tag && match.tag !== "*" && node.localName !== match.tag) return false;
    if (match.attribute) {
      const present = node.hasAttribute(match.attribute.name);
      if (match.attribute.operator === "exists" && !present) return false;
      if (match.attribute.operator === "absent" && present) return false;
      if (match.attribute.operator === "eq" && (!present || node.getAttribute(match.attribute.name) !== match.attribute.value)) return false;
      if (match.attribute.operator === "contains" && (!present || !node.getAttribute(match.attribute.name).includes(match.attribute.value))) return false;
    }
    if (match.text && !compare(node.textContent, match.text.operator, match.text.value)) return false;
    return true;
  }

  function settle() {
    return new Promise(resolve => setTimeout(resolve, 50));
  }

  function toCssProperty(property) {
    return property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
  }
})();
