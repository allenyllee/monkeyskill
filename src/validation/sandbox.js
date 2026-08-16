(() => {
  const nonce = crypto.randomUUID();
  const nativeEval = eval;
  const nativeNow = performance.now.bind(performance);
  const nativeSetTimeout = setTimeout.bind(globalThis);
  const nativeClearTimeout = clearTimeout.bind(globalThis);
  const NativeMessageChannel = MessageChannel;
  const NativeMutationObserver = MutationObserver;
  const nativeFocus = HTMLElement.prototype.focus;
  const nativeBlur = HTMLElement.prototype.blur;
  const nativeInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const nativeTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  const nativeSelectionRemoveAllRanges = Selection.prototype.removeAllRanges;
  const nativeSelectionAddRange = Selection.prototype.addRange;
  const releaseClearEvents = new Set(["mouseup", "pointerup", "keyup", "touchend", "contextmenu"]);
  let trackedActiveElement = null;
  let activeSelectionWriteCounter = null;

  Selection.prototype.removeAllRanges = function trackedRemoveAllRanges(...args) {
    if (activeSelectionWriteCounter) activeSelectionWriteCounter.count += 1;
    return nativeSelectionRemoveAllRanges.apply(this, args);
  };

  Selection.prototype.addRange = function trackedAddRange(...args) {
    if (activeSelectionWriteCounter) activeSelectionWriteCounter.count += 1;
    return nativeSelectionAddRange.apply(this, args);
  };

  // Chrome may throttle or suspend animation frames in the hidden offscreen
  // validation document. Model a browser frame with a trusted task checkpoint
  // so candidates that schedule bounded rAF work can still be tested
  // deterministically without requiring a foreground renderer.
  globalThis.requestAnimationFrame = callback => nativeSetTimeout(() => callback(nativeNow()), 0);
  globalThis.cancelAnimationFrame = handle => nativeClearTimeout(handle);

  HTMLElement.prototype.focus = function trackedFocus(...args) {
    const result = nativeFocus.apply(this, args);
    if (this.isConnected && isFocusableElement(this)) trackedActiveElement = this;
    return result;
  };

  HTMLElement.prototype.blur = function trackedBlur(...args) {
    const result = nativeBlur.apply(this, args);
    if (trackedActiveElement === this) trackedActiveElement = null;
    return result;
  };

  async function onRunTest(event) {
    const message = event.data;
    if (event.source !== parent || message?.type !== "monkeyskill-run-test" || message.nonce !== nonce) return;
    window.removeEventListener("message", onRunTest);
    let result;
    try {
      if (message.capability) result = await executeCapabilitySelfTest(message.capability);
      else result = await executeTest(message.test, message.artifact);
    } catch {
      result = { ok: false, category: "dom-state" };
    }
    parent.postMessage({ type: "monkeyskill-test-result", nonce, result }, "*");
  }

  window.addEventListener("message", onRunTest);

  parent.postMessage({ type: "monkeyskill-sandbox-ready", nonce }, "*");

  function installArtifact(artifact) {
    if (artifact.css) {
      const style = document.createElement("style");
      style.textContent = artifact.css;
      document.head.append(style);
    }
    (0, nativeEval)(`${artifact.js}\n//# sourceURL=monkeyskill-generated-build.js`);
  }

  async function executeTest(test, artifact) {
    const state = {
      nodes: new Map(),
      blockerCalls: new Map(),
      inlineBlockers: new Map(),
      crossWorldRollbacks: [],
      stepResults: []
    };
    createFixture(test.fixture, state);
    installBlockers(test.blockers, state);
    await settle();
    const trace = [];
    let firstRuntimeStep = 0;
    if (test.steps[0]?.action === "startup-stress") {
      const stepResult = await executeStartupStress(test.steps[0], state, artifact);
      stepResult.selectionCollapsed = Boolean(getSelection()?.isCollapsed);
      state.stepResults.push(stepResult);
      trace.push(traceStep(0, test.steps[0], stepResult, state));
      firstRuntimeStep = 1;
    } else {
      installArtifact(artifact);
      await settle();
    }
    for (let index = firstRuntimeStep; index < test.steps.length; index += 1) {
      const step = test.steps[index];
      const stepResult = await executeStep(step, state) || {};
      stepResult.selectionCollapsed = Boolean(getSelection()?.isCollapsed);
      state.stepResults.push(stepResult);
      trace.push(traceStep(index, step, stepResult, state));
    }
    for (const assertion of test.assertions) {
      if (!evaluateAssertion(assertion, state)) {
        return {
          ok: false,
          category: assertionCategory(assertion.type),
          assertion: assertion.type,
          diagnostic: assertionDiagnostic(assertion, state),
          trace
        };
      }
    }
    return { ok: true, category: "dom-state", trace };
  }

  function traceStep(index, step, stepResult, state) {
    const stepTarget = step.target ? state.nodes.get(step.target) : null;
    return {
      step: index,
      action: step.action,
      defaultPrevented: typeof stepResult?.defaultPrevented === "boolean" ? stepResult.defaultPrevented : null,
      durationMs: Number.isFinite(stepResult?.durationMs) ? Math.round(stepResult.durationMs) : null,
      selectionWrites: Number.isInteger(stepResult?.selectionWrites) ? stepResult.selectionWrites : null,
      selectionCollapsed: Boolean(getSelection()?.isCollapsed),
      targetActive: Boolean(stepTarget && (document.activeElement === stepTarget || trackedActiveElement === stepTarget)),
      valueLength: stepTarget && "value" in stepTarget ? String(stepTarget.value).length : null,
      textLength: stepTarget ? String(stepTarget.textContent || "").length : null
    };
  }

  async function executeStartupStress(step, state, artifact) {
    const target = state.nodes.get(step.target);
    if (!target) throw new Error("Startup-stress target missing.");
    const container = createLargePageFixture(step.count, "startup");
    target.append(container);
    await Promise.resolve();
    const quiet = waitForMutationQuiet(target);
    const started = nativeNow();
    installArtifact(artifact);
    // Force injected CSS and startup mutations through a real style/layout
    // checkpoint. DOM quiet alone misses expensive universal selectors until
    // the browser is asked to lay out the large page.
    void container.offsetHeight;
    await quiet;
    // DOM quiet only observes writes. A candidate can still keep the main
    // thread busy with a recursively scheduled traversal that performs no DOM
    // mutations, which previously escaped the startup duration measurement.
    // Give queued zero-delay work a bounded number of native task turns to
    // drain before recording the result.
    await waitForTaskTurns(32);
    return { durationMs: nativeNow() - started };
  }

  function createLargePageFixture(count, prefix) {
    const container = document.createElement("div");
    container.setAttribute(`data-monkeyskill-${prefix}-stress`, "");
    container.style.cssText = "position:relative;max-height:180px;overflow:auto";
    appendLargePageRows(container, count, prefix);
    return container;
  }

  function appendLargePageRows(container, count, prefix) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const row = document.createElement("div");
      const input = document.createElement("input");
      const overlay = document.createElement("div");
      row.style.cssText = "position:relative;height:24px";
      input.style.cssText = "position:absolute;inset:2px 8px;min-height:20px";
      overlay.style.cssText = "position:absolute;inset:2px 8px;min-height:20px";
      const y = index * 4;
      const rect = Object.freeze({ x: 0, y, left: 0, top: y, right: 120, bottom: y + 3, width: 120, height: 3 });
      input.id = `${prefix}-target-${index}`;
      overlay.id = `${prefix}-overlay-${index}`;
      input.getBoundingClientRect = () => rect;
      overlay.getBoundingClientRect = () => rect;
      row.append(input, overlay);
      fragment.append(row);
    }
    container.append(fragment);
  }

  function createFixture(fixture, state) {
    const root = document.querySelector("#fixture");
    root.replaceChildren();
    for (const style of document.querySelectorAll("style[data-monkeyskill-fixture-style]")) style.remove();
    for (const node of fixture.nodes) createNode(node, state, root);
    for (const rule of fixture.rules) {
      const style = document.createElement("style");
      style.dataset.monkeyskillFixtureStyle = "";
      const declarations = Object.entries(rule.styles)
        .map(([property, value]) => `${toCssProperty(property)}:${value}!important`)
        .join(";");
      const target = `#${CSS.escape(rule.target)}`;
      // `id-ancestor` models a page rule whose ID belongs to an ancestor,
      // while the selected descendant itself may have no useful ID. Do not
      // include the target ID in that selector: candidates must override the
      // descendant pseudo-element, not merely the ancestor's own ::selection.
      const selector = rule.specificity === "id-ancestor"
        ? `#fixture *${rule.pseudo}`
        : `${target}${rule.pseudo || ""}`;
      style.textContent = `${selector}{${declarations}}`;
      document.head.append(style);
    }
  }

  function createNode(node, state, root) {
    const element = document.createElement(node.tag);
    element.id = node.id;
    if (node.text) element.textContent = node.text;
    for (const [name, value] of Object.entries(node.attributes)) {
      element.setAttribute(name, value);
      // The TestSpec DSL describes initial control state, not HTML parser
      // source text. Keep reflected DOM properties consistent across input,
      // textarea, select, and option fixtures.
      if (name === "value" && "value" in element) element.value = value;
    }
    for (const [property, value] of Object.entries(node.styles)) element.style[property] = value;
    if (node.rect) {
      const { x, y, width, height } = node.rect;
      const style = document.createElement("style");
      style.dataset.monkeyskillFixtureStyle = "";
      style.textContent = `#${CSS.escape(node.id)}{position:absolute!important;left:${x}px!important;top:${y}px!important;width:${width}px!important;height:${height}px!important;box-sizing:border-box!important}`;
      document.head.append(style);
    }
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
      if (blocker.effect === "return-false") return false;
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
    if (blocker.event === "input" && blocker.effect === "rollback-value") {
      state.crossWorldRollbacks.push(installed);
    }
    if (blocker.registration === "inline") {
      state.inlineBlockers.set(blocker.id, installed);
      target.setAttribute(`on${blocker.event}`, `return globalThis.__monkeySkillTestInlineBlocker(${JSON.stringify(blocker.id)}, event)`);
    } else if (blocker.registration === "property") {
      target[`on${blocker.event}`] = event => {
        if (!matchesWhen(event, blocker.when)) return true;
        applyEffect(installed, event, state);
        return blocker.effect === "return-false" ? false : !event.defaultPrevented;
      };
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
    if (blocker.effect === "clear-selection") {
      if (releaseClearEvents.has(event.type)) queueMicrotask(() => getSelection()?.removeAllRanges());
      else getSelection()?.removeAllRanges();
    }
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
    if (step.action === "scroll-page") {
      window.scrollTo(step.left, step.top);
      await settle();
      return null;
    }
    if (step.action === "mutation-burst") {
      const target = state.nodes.get(step.target);
      if (!target) throw new Error("Mutation-burst target missing.");
      const quiet = waitForMutationQuiet(target);
      const container = document.createElement("div");
      container.setAttribute("data-monkeyskill-mutation-burst", "");
      target.append(container);
      const started = nativeNow();
      for (let offset = 0; offset < step.count; offset += step.batchSize) {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < step.batchSize; index += 1) {
          const node = document.createElement("div");
          node.id = `dynamic-${offset + index}`;
          const text = document.createElement("span");
          text.textContent = `row ${offset + index}`;
          node.append(text);
          fragment.append(node);
        }
        container.append(fragment);
        await Promise.resolve();
      }
      await quiet;
      const durationMs = nativeNow() - started;
      container.remove();
      await Promise.resolve();
      return { durationMs };
    }
    if (step.action === "scroll-stress") {
      const target = state.nodes.get(step.target);
      if (!target) throw new Error("Scroll-stress target missing.");
      const started = nativeNow();
      const setupQuiet = waitForMutationQuiet(target);
      // Keep the row insertion live, matching large application/demo updates.
      // Appending a prebuilt wrapper would collapse 1200 sibling additions into
      // one observed subtree and miss candidates that rescan each added root.
      const container = createLargePageFixture(0, "scroll");
      target.append(container);
      appendLargePageRows(container, step.count, "scroll");
      void container.offsetHeight;
      await setupQuiet;
      const scrollQuiet = waitForMutationQuiet(target);
      for (let index = 0; index < step.iterations; index += 1) {
        container.scrollTop = index % 2 ? 0 : container.scrollHeight;
        window.dispatchEvent(new Event("scroll"));
        await new Promise(resolve => requestAnimationFrame(resolve));
        void container.offsetHeight;
      }
      await scrollQuiet;
      const durationMs = nativeNow() - started;
      container.remove();
      await Promise.resolve();
      return { durationMs };
    }
    const target = state.nodes.get(step.target);
    if (!target) throw new Error("Step target missing.");
    if (step.action === "select-contents") {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(createEvent("selectionchange", {}));
      return null;
    }
    if (step.action === "drag-select-text") return dragSelectText(target);
    if (step.action === "paste-text") return pasteText(target, step.value, state);
    if (step.action === "copy-shortcut") return copyShortcut(target, step.operation);
    if (step.action === "click-control") return clickControl(target);
    if (step.action === "click-page") return clickPage(target);
    if (step.action === "focus") {
      target.focus();
      return null;
    }
    if (step.action === "blur") {
      target.blur();
      await settle();
      return null;
    }
    if (step.action === "click") {
      target.click();
      await settle();
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
    if (step.action === "set-text") {
      target.textContent = step.value;
      await settle();
      return null;
    }
    if (step.action === "set-checked") {
      target.checked = step.value;
      return null;
    }
    if (step.action === "scroll") {
      target.scrollLeft = step.left;
      target.scrollTop = step.top;
      await settle();
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

  async function dragSelectText(target) {
    const selectionWrites = { count: 0 };
    activeSelectionWriteCounter = selectionWrites;
    const down = { button: 0, buttons: 1, clientX: 10, clientY: 10 };
    const pointerDown = createEvent("pointerdown", down);
    target.dispatchEvent(pointerDown);
    const mouseDown = createEvent("mousedown", down);
    target.dispatchEvent(mouseDown);
    const move = { button: 0, buttons: 1, clientX: 100, clientY: 10 };
    target.dispatchEvent(createEvent("pointermove", move));
    target.dispatchEvent(createEvent("mousemove", move));
    const selectStart = createEvent("selectstart", {});
    target.dispatchEvent(selectStart);
    const blocked = pointerDown.defaultPrevented || mouseDown.defaultPrevented || selectStart.defaultPrevented;
    if (!blocked) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    target.dispatchEvent(createEvent("pointerup", { button: 0, buttons: 0 }));
    target.dispatchEvent(createEvent("mouseup", { button: 0, buttons: 0 }));
    await settle();
    activeSelectionWriteCounter = null;
    return { defaultPrevented: blocked, selectionWrites: selectionWrites.count };
  }

  async function pasteText(target, value, state) {
    if (!("value" in target) && !target.isContentEditable) throw new Error("paste-text target is not editable.");
    target.focus();
    if (typeof target.setSelectionRange === "function") {
      const end = String(readNativeValue(target) || "").length;
      target.setSelectionRange(end, end);
    } else if (target.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const paste = createEvent("paste", {});
    target.dispatchEvent(paste);
    if (paste.defaultPrevented) {
      await settle();
      return { defaultPrevented: true };
    }
    // Chromium does not guarantee that native paste exposes the inserted text
    // through InputEvent.data. Keep the trusted text inside the workflow for
    // the browser-equivalent edit, but do not leak it through the synthetic
    // beforeinput/input events. This catches candidates that pass the sandbox
    // only by replaying event.data and then fail on real pages.
    const inputInit = { inputType: "insertFromPaste", data: null };
    const beforeInput = createEvent("beforeinput", inputInit);
    target.dispatchEvent(beforeInput);
    if (!beforeInput.defaultPrevented) {
      insertText(target, value);
      // Real Chromium may deliver the resulting input in a later task. Yield
      // so zero-delay guard cleanup cannot pass only because this runner was
      // unrealistically synchronous.
      await new Promise(resolve => setTimeout(resolve, 0));
      // The resulting input event is even less reliable across Chromium
      // versions and automation paths: neither data nor inputType is a safe
      // paste transaction identifier. Candidates must carry forward the
      // target marked by paste/beforeinput instead of keying off this event.
      const input = new InputEvent("input", { bubbles: true, inputType: "", data: null });
      target.dispatchEvent(input);
      // A generated MAIN/USER_SCRIPT-world guard must not make a page-world
      // rollback disappear from the test. Reapply the declared rollback at
      // the trusted post-dispatch checkpoint; a valid candidate must recover
      // after this checkpoint without cancelling native paste.
      for (const blocker of state.crossWorldRollbacks) {
        if (blocker.target !== target.id) continue;
        if (blocker.when?.inputType && blocker.when.inputType !== "insertFromPaste") continue;
        target.value = blocker.initialValue || "";
      }
    }
    await settle();
    return { defaultPrevented: beforeInput.defaultPrevented };
  }

  async function copyShortcut(target, operation) {
    target.focus();
    if (typeof target.select === "function") target.select();
    else {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(createEvent("selectionchange", {}));
    }
    const key = operation === "cut" ? "x" : "c";
    const keydown = createEvent("keydown", { key, ctrlKey: true, metaKey: true });
    target.dispatchEvent(keydown);
    let command = null;
    let beforeInput = null;
    if (!keydown.defaultPrevented) {
      command = createEvent(operation, {});
      target.dispatchEvent(command);
      if (operation === "cut" && !command.defaultPrevented) {
        beforeInput = createEvent("beforeinput", { inputType: "deleteByCut", data: null });
        target.dispatchEvent(beforeInput);
        if (!beforeInput.defaultPrevented) {
          deleteSelectedContent(target);
          target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteByCut", data: null }));
        }
      }
    }
    await settle();
    return {
      defaultPrevented: keydown.defaultPrevented || Boolean(command?.defaultPrevented) || Boolean(beforeInput?.defaultPrevented)
    };
  }

  function deleteSelectedContent(target) {
    if ("value" in target && Number.isInteger(target.selectionStart) && Number.isInteger(target.selectionEnd)) {
      target.setRangeText("", target.selectionStart, target.selectionEnd, "end");
      return;
    }
    getSelection()?.deleteFromDocument();
  }

  async function clickControl(target) {
    return primaryClick(target, true);
  }

  async function clickPage(target) {
    const down = { button: 0, buttons: 1 };
    const pointerDown = createEvent("pointerdown", down);
    const mouseDown = createEvent("mousedown", down);
    target.dispatchEvent(pointerDown);
    target.dispatchEvent(mouseDown);

    if (!pointerDown.defaultPrevented && !mouseDown.defaultPrevented) {
      // Chrome may report the still-live range during a new primary gesture,
      // then apply the native selection collapse after the release events.
      document.dispatchEvent(createEvent("selectionchange", {}));
    }

    target.dispatchEvent(createEvent("pointerup", { button: 0, buttons: 0 }));
    target.dispatchEvent(createEvent("mouseup", { button: 0, buttons: 0 }));
    const click = createEvent("click", { button: 0, buttons: 0 });
    target.dispatchEvent(click);

    if (!pointerDown.defaultPrevented && !mouseDown.defaultPrevented) {
      await new Promise(resolve => setTimeout(() => {
        getSelection()?.removeAllRanges();
        document.dispatchEvent(createEvent("selectionchange", {}));
        resolve();
      }, 0));
    }
    await settle();
    return { defaultPrevented: click.defaultPrevented };
  }

  async function primaryClick(target, focusTarget) {
    const down = { button: 0, buttons: 1 };
    const pointerDown = createEvent("pointerdown", down);
    const mouseDown = createEvent("mousedown", down);
    target.dispatchEvent(pointerDown);
    target.dispatchEvent(mouseDown);
    if (!pointerDown.defaultPrevented && !mouseDown.defaultPrevented) {
      getSelection()?.removeAllRanges();
      if (focusTarget) target.focus();
    }
    target.dispatchEvent(createEvent("pointerup", { button: 0, buttons: 0 }));
    target.dispatchEvent(createEvent("mouseup", { button: 0, buttons: 0 }));
    const click = createEvent("click", { button: 0, buttons: 0 });
    target.dispatchEvent(click);
    await settle();
    return { defaultPrevented: click.defaultPrevented };
  }

  function insertText(target, value) {
    if ("value" in target) {
      const current = String(readNativeValue(target) || "");
      const start = Number.isInteger(target.selectionStart) ? target.selectionStart : current.length;
      const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
      // Model Chromium's native edit, which bypasses an instance-level value
      // setter guard. The later page rollback deliberately uses target.value
      // so a generated transaction guard can distinguish the two writes.
      writeNativeValue(target, `${current.slice(0, start)}${value}${current.slice(end)}`);
      if (typeof target.setSelectionRange === "function") target.setSelectionRange(start + value.length, start + value.length);
      return;
    }
    target.textContent += value;
  }

  function nativeValueDescriptor(target) {
    if (target instanceof HTMLInputElement) return nativeInputValue;
    if (target instanceof HTMLTextAreaElement) return nativeTextareaValue;
    return null;
  }

  function readNativeValue(target) {
    const descriptor = nativeValueDescriptor(target);
    return descriptor?.get ? descriptor.get.call(target) : target.value;
  }

  function writeNativeValue(target, value) {
    const descriptor = nativeValueDescriptor(target);
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
  }

  function createEvent(type, init) {
    const options = { bubbles: true, cancelable: true, ...init };
    if (type === "keydown" || type === "keyup") return new KeyboardEvent(type, options);
    if (type === "input" || type === "beforeinput") return new InputEvent(type, options);
    if (type === "wheel") return new WheelEvent(type, options);
    if (type === "focus" || type === "blur") return new FocusEvent(type, options);
    if (type.startsWith("pointer") && typeof PointerEvent === "function") return new PointerEvent(type, options);
    if (["click", "dblclick", "contextmenu", "mousedown", "mouseenter", "mouseleave", "mousemove", "mouseup"].includes(type)) {
      return new MouseEvent(type, options);
    }
    return new Event(type, options);
  }

  function evaluateAssertion(assertion, state) {
    if (assertion.type === "event-default-prevented") {
      return state.stepResults[assertion.step]?.defaultPrevented === assertion.expected;
    }
    if (assertion.type === "step-duration") {
      return compareNumeric(state.stepResults[assertion.step]?.durationMs, assertion.operator, assertion.value, 0);
    }
    if (assertion.type === "selection-write-count") {
      return compareNumeric(state.stepResults[assertion.step]?.selectionWrites, assertion.operator, assertion.value, 0);
    }
    if (assertion.type === "blocker-call-count") {
      return compare(state.blockerCalls.get(assertion.blocker) || 0, assertion.operator, assertion.value);
    }
    if (assertion.type === "selection-collapsed") {
      const actual = assertion.step == null
        ? Boolean(getSelection()?.isCollapsed)
        : state.stepResults[assertion.step]?.selectionCollapsed;
      return actual === assertion.expected;
    }
    if (assertion.type === "node-count") {
      const scope = state.nodes.get(assertion.scope);
      return compare(queryNodes(scope, assertion.relation, assertion.match).length, assertion.operator, assertion.value);
    }
    const target = state.nodes.get(assertion.target);
    if (assertion.type === "dom-present") return Boolean(target?.isConnected) === assertion.expected;
    if (!target) return false;
    if (assertion.type === "active-element") {
      return (document.activeElement === target || trackedActiveElement === target) === assertion.expected;
    }
    if (assertion.type === "visible") return isVisible(target) === assertion.expected;
    if (assertion.type === "hit-test") return isTopmostAt(target, assertion.point) === assertion.expected;
    if (assertion.type === "computed-style") {
      return compare(getComputedStyle(target, assertion.pseudo)[assertion.property], assertion.operator, assertion.value);
    }
    if (assertion.type === "bounding-rect") {
      return compareNumeric(target.getBoundingClientRect()[assertion.property], assertion.operator, assertion.value, assertion.tolerance);
    }
    if (assertion.type === "relative-position") {
      return comparePosition(target.getBoundingClientRect(), state.nodes.get(assertion.other)?.getBoundingClientRect(), assertion.relation, assertion.tolerance);
    }
    if (assertion.type === "contrast-ratio") {
      return compareNumeric(contrastRatio(target), assertion.operator, assertion.value, 0);
    }
    if (assertion.type === "scroll-offset") {
      return compareNumeric(assertion.axis === "left" ? target.scrollLeft : target.scrollTop, assertion.operator, assertion.value, assertion.tolerance);
    }
    if (assertion.type === "property") return Boolean(target[assertion.name]) === assertion.expected;
    if (assertion.type === "attribute-refers-to") {
      const other = state.nodes.get(assertion.other);
      const tokens = (target.getAttribute(assertion.name) || "").split(/\s+/).filter(Boolean);
      return (Boolean(other?.id) && tokens.includes(other.id)) === assertion.expected;
    }
    if (assertion.type === "value") return compare(target.value, assertion.operator, assertion.value);
    if (assertion.type === "text-content") return compare(target.textContent, assertion.operator, assertion.value);
    const present = target.hasAttribute(assertion.name);
    if (assertion.operator === "exists") return present;
    if (assertion.operator === "absent") return !present;
    if (assertion.operator === "contains") return present && target.getAttribute(assertion.name).includes(assertion.value);
    return present && target.getAttribute(assertion.name) === assertion.value;
  }

  function compare(actual, operator, expected) {
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    if (operator === "contains") return String(actual).includes(String(expected));
    if (operator === "gte") return Number(actual) >= Number(expected);
    return false;
  }

  function compareNumeric(actual, operator, expected, tolerance = 0) {
    if (!Number.isFinite(actual)) return false;
    if (operator === "approx") return Math.abs(actual - expected) <= tolerance;
    if (operator === "eq") return Math.abs(actual - expected) <= tolerance;
    if (operator === "neq") return Math.abs(actual - expected) > tolerance;
    if (operator === "gt") return actual > expected;
    if (operator === "gte") return actual >= expected;
    if (operator === "lt") return actual < expected;
    if (operator === "lte") return actual <= expected;
    return false;
  }

  function assertionCategory(type) {
    if (type === "event-default-prevented") return "event-state";
    if (type === "step-duration") return "performance-state";
    if (type === "blocker-call-count") return "blocker-state";
    if (type === "computed-style") return "computed-style";
    if (type === "active-element") return "focus-state";
    if (["bounding-rect", "relative-position", "scroll-offset"].includes(type)) return "layout-state";
    if (["contrast-ratio", "hit-test", "visible"].includes(type)) return "visibility-state";
    if (type === "property") return "property-state";
    if (type === "attribute-refers-to") return "accessibility-state";
    if (["selection-collapsed", "selection-write-count"].includes(type)) return "selection-state";
    if (type === "value") return "value-state";
    if (type === "text-content") return "value-state";
    if (type === "attribute") return "attribute-state";
    return "dom-state";
  }

  function assertionDiagnostic(assertion, state) {
    let property = assertion.type;
    let actual;
    if (assertion.type === "event-default-prevented") {
      actual = state.stepResults[assertion.step]?.defaultPrevented;
    } else if (assertion.type === "step-duration") {
      property = "durationMs";
      actual = state.stepResults[assertion.step]?.durationMs;
    } else if (assertion.type === "selection-collapsed") {
      actual = assertion.step == null
        ? Boolean(getSelection()?.isCollapsed)
        : state.stepResults[assertion.step]?.selectionCollapsed;
    } else if (assertion.type === "selection-write-count") {
      property = "selectionWrites";
      actual = state.stepResults[assertion.step]?.selectionWrites;
    } else if (assertion.type === "blocker-call-count") {
      actual = state.blockerCalls.get(assertion.blocker) || 0;
    } else {
      const target = state.nodes.get(assertion.target);
      if (assertion.type === "computed-style") {
        property = assertion.property;
        actual = target ? getComputedStyle(target, assertion.pseudo)[assertion.property] : "<missing-target>";
      } else if (assertion.type === "value") actual = target?.value;
      else if (assertion.type === "text-content") actual = target?.textContent;
      else if (assertion.type === "active-element") actual = document.activeElement === target || trackedActiveElement === target;
      else if (assertion.type === "visible") actual = target ? isVisible(target) : false;
      else return null;
    }
    return {
      property,
      operator: assertion.operator || "eq",
      actual: diagnosticValue(actual),
      expected: diagnosticValue(assertion.expected ?? assertion.value)
    };
  }

  function diagnosticValue(value) {
    return String(value).replace(/[\r\n]/g, " ").slice(0, 120);
  }

  async function executeCapabilitySelfTest(capability) {
    if (capability === "hit-test") {
      const target = document.createElement("div");
      const overlay = document.createElement("div");
      for (const element of [target, overlay]) {
        element.style.cssText = "position:fixed;left:20px;top:20px;width:80px;height:60px";
      }
      overlay.style.zIndex = "2";
      document.querySelector("#fixture").replaceChildren(target, overlay);
      await settle();
      const before = document.elementFromPoint(60, 50) === overlay;
      overlay.style.pointerEvents = "none";
      await settle();
      const after = document.elementFromPoint(60, 50) === target;
      return { ok: before && after, capability, nativeSupported: before && after };
    }
    if (capability === "drag-select-text") {
      const target = document.createElement("p");
      target.textContent = "MonkeyTest drag selection conformance";
      document.querySelector("#fixture").replaceChildren(target);
      let pointerMoved = false;
      let mouseMoved = false;
      target.addEventListener("pointermove", () => { pointerMoved = true; });
      target.addEventListener("mousemove", () => { mouseMoved = true; });
      const baseline = await dragSelectText(target);
      const selected = !getSelection()?.isCollapsed;
      getSelection()?.removeAllRanges();
      const blockedTarget = document.createElement("p");
      blockedTarget.textContent = "Blocked drag selection conformance";
      blockedTarget.addEventListener("mousedown", event => event.preventDefault());
      document.querySelector("#fixture").replaceChildren(blockedTarget);
      const blocked = await dragSelectText(blockedTarget);
      const blockerPreventedSelection = blocked.defaultPrevented && Boolean(getSelection()?.isCollapsed);
      return {
        ok: !baseline.defaultPrevented && selected && pointerMoved && mouseMoved && blockerPreventedSelection,
        capability,
        nativeSupported: selected && pointerMoved && mouseMoved && blockerPreventedSelection
      };
    }
    if (capability === "copy-shortcut") {
      const target = document.createElement("textarea");
      target.value = "cut me";
      document.querySelector("#fixture").replaceChildren(target);
      const copy = await copyShortcut(target, "copy");
      const copyPreserved = target.value === "cut me";
      const cut = await copyShortcut(target, "cut");
      const cutDeleted = target.value === "";
      const blockedTarget = document.createElement("textarea");
      blockedTarget.value = "must remain";
      blockedTarget.addEventListener("keydown", event => event.preventDefault());
      document.querySelector("#fixture").replaceChildren(blockedTarget);
      const blocked = await copyShortcut(blockedTarget, "cut");
      const blockerStoppedDefault = blocked.defaultPrevented && blockedTarget.value === "must remain";
      return {
        ok: !copy.defaultPrevented && !cut.defaultPrevented && copyPreserved && cutDeleted && blockerStoppedDefault,
        capability,
        nativeSupported: copyPreserved && cutDeleted && blockerStoppedDefault
      };
    }
    if (capability !== "focus") return { ok: false, capability, category: "dom-state" };
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.querySelector("#fixture").replaceChildren(input, editable);
    input.focus();
    const inputTracked = trackedActiveElement === input;
    const inputNative = document.activeElement === input;
    editable.focus();
    const editableTracked = trackedActiveElement === editable;
    const editableNative = document.activeElement === editable;
    editable.blur();
    const blurTracked = trackedActiveElement === null;
    return {
      ok: inputTracked && editableTracked && blurTracked,
      capability,
      nativeSupported: inputNative && editableNative
    };
  }

  function isFocusableElement(element) {
    return element.matches("a[href],button,input,textarea,select,[tabindex],[contenteditable]:not([contenteditable='false'])");
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

  function isVisible(target) {
    if (!target.isConnected) return false;
    for (let node = target; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
    }
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isTopmostAt(target, point) {
    const rect = target.getBoundingClientRect();
    const inset = 1;
    const points = {
      center: [rect.left + rect.width / 2, rect.top + rect.height / 2],
      "top-left": [rect.left + inset, rect.top + inset],
      "top-right": [rect.right - inset, rect.top + inset],
      "bottom-left": [rect.left + inset, rect.bottom - inset],
      "bottom-right": [rect.right - inset, rect.bottom - inset]
    };
    const [x, y] = points[point];
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === target || target.contains(hit)));
  }

  function comparePosition(rect, other, relation, tolerance) {
    if (!other) return false;
    if (relation === "above") return rect.bottom <= other.top + tolerance;
    if (relation === "below") return rect.top >= other.bottom - tolerance;
    if (relation === "left-of") return rect.right <= other.left + tolerance;
    if (relation === "right-of") return rect.left >= other.right - tolerance;
    if (relation === "inside") {
      return rect.left >= other.left - tolerance && rect.top >= other.top - tolerance
        && rect.right <= other.right + tolerance && rect.bottom <= other.bottom + tolerance;
    }
    const overlaps = rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top;
    if (relation === "overlaps") return overlaps;
    if (relation === "not-overlaps") return !overlaps;
    if (relation === "aligned-x") return Math.abs((rect.left + rect.right) / 2 - (other.left + other.right) / 2) <= tolerance;
    if (relation === "aligned-y") return Math.abs((rect.top + rect.bottom) / 2 - (other.top + other.bottom) / 2) <= tolerance;
    return false;
  }

  function contrastRatio(target) {
    const foreground = parseColor(getComputedStyle(target).color);
    const background = effectiveBackground(target);
    if (!foreground || !background) return NaN;
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  function effectiveBackground(target) {
    let result = [255, 255, 255, 1];
    const layers = [];
    for (let node = target; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color) layers.push(color);
    }
    for (let index = layers.length - 1; index >= 0; index -= 1) result = composite(layers[index], result);
    return result;
  }

  function parseColor(value) {
    const match = String(value).match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])] : null;
  }

  function composite(foreground, background) {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    return [
      (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
      (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
      (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
      alpha
    ];
  }

  function luminance(color) {
    const channels = color.slice(0, 3).map(value => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function settle() {
    return new Promise(resolve => setTimeout(resolve, 50));
  }

  async function waitForTaskTurns(count) {
    for (let index = 0; index < count; index += 1) {
      await new Promise(resolve => {
        const channel = new NativeMessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
    }
    // Preserve one real timer checkpoint so zero-delay work scheduled by the
    // candidate can run, without charging the candidate for dozens of timer
    // turns that hidden extension documents may clamp to a full frame each.
    await new Promise(resolve => nativeSetTimeout(resolve, 0));
  }

  function waitForMutationQuiet(root, quietMs = 50, maxMs = 1200) {
    return new Promise(resolve => {
      const started = nativeNow();
      let lastMutation = started;
      const observer = new NativeMutationObserver(() => {
        lastMutation = nativeNow();
      });
      // Candidate work may be triggered below the fixture but write elsewhere,
      // such as repeatedly rebuilding a generated stylesheet in <head>. Keep
      // those queued writes inside the measured performance checkpoint.
      observer.observe(document.documentElement || root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      const check = () => {
        const now = nativeNow();
        if (now - lastMutation >= quietMs || now - started >= maxMs) {
          observer.disconnect();
          resolve();
          return;
        }
        nativeSetTimeout(check, 10);
      };
      nativeSetTimeout(check, 10);
    });
  }

  function toCssProperty(property) {
    return property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
  }
})();
