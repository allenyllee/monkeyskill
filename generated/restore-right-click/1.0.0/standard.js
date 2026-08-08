(() => {
  const marker = "__monkeySkillRestoreRightClickStandard";
  if (window[marker]) return;
  window[marker] = true;

  const protectedEvents = [
    "contextmenu",
    "copy",
    "cut",
    "selectstart",
    "dragstart"
  ];
  const handlerAttributes = protectedEvents.map(type => `on${type}`);

  const letBrowserHandleIt = event => {
    event.stopImmediatePropagation();
  };

  for (const type of protectedEvents) {
    window.addEventListener(type, letBrowserHandleIt, true);
  }

  window.addEventListener("keydown", event => {
    const shortcut = event.ctrlKey || event.metaKey;
    if (shortcut && ["a", "c", "x"].includes(event.key.toLowerCase())) {
      event.stopImmediatePropagation();
    }
  }, true);

  function cleanElement(element) {
    if (!(element instanceof Element)) return;
    for (const attribute of handlerAttributes) {
      element.removeAttribute(attribute);
    }
  }

  function cleanTree(root) {
    if (root instanceof Element) cleanElement(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof Element)) return;
    const selector = handlerAttributes.map(attribute => `[${attribute}]`).join(",");
    for (const element of root.querySelectorAll(selector)) {
      cleanElement(element);
    }
  }

  cleanTree(document);
  document.addEventListener("DOMContentLoaded", () => cleanTree(document), { once: true });

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") cleanElement(record.target);
      for (const node of record.addedNodes) cleanTree(node);
    }
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: handlerAttributes
  });
})();
