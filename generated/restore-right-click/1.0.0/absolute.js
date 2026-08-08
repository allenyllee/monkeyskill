(() => {
  const marker = "__monkeySkillRestoreRightClickAbsolute";
  if (window[marker]) return;
  window[marker] = true;

  const protectedEvents = new Set([
    "contextmenu",
    "copy",
    "cut",
    "selectstart",
    "dragstart",
    "selectionchange"
  ]);
  const handlerAttributes = [...protectedEvents].map(type => `on${type}`);
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativePreventDefault = Event.prototype.preventDefault;

  const swallowSiteHandler = event => {
    event.stopImmediatePropagation();
  };

  for (const type of protectedEvents) {
    nativeAddEventListener.call(window, type, swallowSiteHandler, true);
  }

  for (const type of ["mousedown", "pointerdown"]) {
    nativeAddEventListener.call(window, type, event => {
      if (event.button === 2) event.stopImmediatePropagation();
    }, true);
  }

  nativeAddEventListener.call(window, "keydown", event => {
    const shortcut = event.ctrlKey || event.metaKey;
    if (shortcut && ["a", "c", "x"].includes(event.key.toLowerCase())) {
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
    for (const attribute of handlerAttributes) {
      element.removeAttribute(attribute);
    }
    if (element.getAttribute("unselectable") === "on") {
      element.removeAttribute("unselectable");
    }
  }

  function cleanTree(root) {
    if (root instanceof Element) cleanElement(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;
    const selector = [
      ...handlerAttributes.map(attribute => `[${attribute}]`),
      "[unselectable='on']"
    ].join(",");
    for (const element of root.querySelectorAll(selector)) cleanElement(element);
  }

  cleanTree(document);
  clearAssignedHandlers();
  document.addEventListener("DOMContentLoaded", () => {
    cleanTree(document);
    clearAssignedHandlers();
  }, { once: true });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") cleanElement(record.target);
      for (const node of record.addedNodes) cleanTree(node);
    }
    clearAssignedHandlers();
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...handlerAttributes, "unselectable"]
  });

  setInterval(clearAssignedHandlers, 1500);
})();
