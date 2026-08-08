(() => {
  const marker = "__monkeySkillRestoreRightClickAbsoluteV111";
  if (window[marker]) return;
  window[marker] = true;

  const protectedEvents = new Set([
    "contextmenu", "copy", "cut", "paste", "selectstart", "dragstart", "selectionchange"
  ]);
  const selectionReleaseEvents = ["mouseup", "keyup", "touchend"];
  const handlerAttributes = [...protectedEvents].map(type => `on${type}`);
  const pointerHandlerAttributes = ["onmousedown", "onpointerdown"];
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativePreventDefault = Event.prototype.preventDefault;
  const swallowSiteHandler = event => event.stopImmediatePropagation();

  for (const type of protectedEvents) nativeAddEventListener.call(window, type, swallowSiteHandler, true);

  for (const type of ["mousedown", "pointerdown"]) {
    nativeAddEventListener.call(window, type, event => {
      if (event.button === 2) event.stopImmediatePropagation();
    }, true);
  }

  for (const type of selectionReleaseEvents) {
    nativeAddEventListener.call(window, type, event => {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) event.stopImmediatePropagation();
    }, true);
  }

  for (const type of ["beforeinput", "input"]) {
    nativeAddEventListener.call(window, type, event => {
      if (event.inputType === "insertFromPaste") event.stopImmediatePropagation();
    }, true);
  }

  nativeAddEventListener.call(window, "keydown", event => {
    const shortcut = event.ctrlKey || event.metaKey;
    if (shortcut && ["a", "c", "v", "x"].includes(event.key.toLowerCase())) {
      event.stopImmediatePropagation();
    }
  }, true);

  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    if (protectedEvents.has(String(type).toLowerCase())) return;
    return nativeAddEventListener.call(this, type, listener, options);
  };

  Event.prototype.preventDefault = function patchedPreventDefault() {
    if (protectedEvents.has(String(this.type).toLowerCase())) return;
    return nativePreventDefault.call(this);
  };

  function clearAssignedHandlers() {
    for (const target of [window, document, document.documentElement, document.body]) {
      if (!target) continue;
      for (const type of protectedEvents) {
        try {
          target[`on${type}`] = null;
        } catch {
          // Some host objects expose read-only event properties.
        }
      }
    }
  }

  function cleanElement(element) {
    if (!(element instanceof Element)) return;
    for (const attribute of handlerAttributes) element.removeAttribute(attribute);
    for (const attribute of pointerHandlerAttributes) {
      const source = element.getAttribute(attribute);
      if (source && isCancellingInlineHandler(source)) element.removeAttribute(attribute);
    }
    if (element.getAttribute("unselectable") === "on") element.removeAttribute("unselectable");
  }

  function isCancellingInlineHandler(source) {
    return /return\s*(?:false|!\s*1)|preventDefault\s*\(/i.test(source);
  }

  function cleanTree(root) {
    if (root instanceof Element) cleanElement(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;
    const selector = [
      ...handlerAttributes.map(attribute => `[${attribute}]`),
      ...pointerHandlerAttributes.map(attribute => `[${attribute}]`),
      "[unselectable='on']"
    ].join(",");
    for (const element of root.querySelectorAll(selector)) cleanElement(element);
  }

  function restorePointerTargets() {
    const targetSelector = "img,canvas,input,textarea,video,[contenteditable='true']";
    const targets = [...document.querySelectorAll(targetSelector)];
    for (const target of targets) {
      if (getComputedStyle(target).pointerEvents === "none") {
        target.style.setProperty("pointer-events", "auto", "important");
      }
    }

    for (const element of document.querySelectorAll("body *")) {
      if (element.matches(targetSelector) || element.childElementCount > 0 || element.textContent.trim()) continue;
      const style = getComputedStyle(element);
      if (!["absolute", "fixed"].includes(style.position) || style.pointerEvents === "none") continue;
      const parentTargets = [...element.parentElement?.querySelectorAll(targetSelector) ?? []];
      if (parentTargets.some(target => substantiallyOverlaps(element, target))) {
        element.style.setProperty("pointer-events", "none", "important");
      }
    }
  }

  function substantiallyOverlaps(overlay, target) {
    const overlayRect = overlay.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const width = Math.max(0, Math.min(overlayRect.right, targetRect.right) - Math.max(overlayRect.left, targetRect.left));
    const height = Math.max(0, Math.min(overlayRect.bottom, targetRect.bottom) - Math.max(overlayRect.top, targetRect.top));
    const targetArea = targetRect.width * targetRect.height;
    return targetArea > 0 && width * height / targetArea >= 0.5;
  }

  function repairPage() {
    cleanTree(document);
    clearAssignedHandlers();
    restorePointerTargets();
  }

  repairPage();
  nativeAddEventListener.call(document, "DOMContentLoaded", repairPage, { once: true });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") cleanElement(record.target);
      for (const node of record.addedNodes) cleanTree(node);
    }
    clearAssignedHandlers();
    restorePointerTargets();
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      ...handlerAttributes,
      ...pointerHandlerAttributes,
      "unselectable", "class", "style"
    ]
  });

  setInterval(repairPage, 1500);
})();
