globalThis.__monkeySkillAcceptanceTests = {
  async "method-01-inline-event-blocking"(h) {
    h.setBody(`<div id="target" oncontextmenu="window.__blocked=true; return false" onmousedown="if(event.button===2){window.__blocked=true; return false}">target</div>`);
    await h.settle();
    h.fire("#target", "mousedown", { button: 2 });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!window.__blocked && !event.defaultPrevented, "inline right-click handlers still ran");
  },

  async "method-02-input-event-listener"(h) {
    h.setBody(`<input id="target">`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "input contextmenu listener still ran");
  },

  async "method-03-paste-event"(h) {
    h.setBody(`<input id="target">`);
    let blocked = false;
    h.target().addEventListener("paste", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "paste");
    h.assert(!blocked && !event.defaultPrevented, "paste listener still ran");
  },

  async "method-04-image-event-listener"(h) {
    h.setBody(`<img id="target" alt="test">`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "image contextmenu listener still ran");
  },

  async "method-05-alert-blocker"(h) {
    h.setBody(`<div id="target">target</div>`);
    let alerted = false;
    h.target().addEventListener("contextmenu", event => { alerted = true; event.preventDefault(); });
    h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!alerted, "right-click alert handler still ran");
  },

  async "method-06-pointer-events"(h) {
    h.setBody(`<img id="target" style="pointer-events:none" alt="test">`);
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "media pointer-events remains none");
  },

  async "method-07-overlay-event"(h) {
    h.setBody(`<div id="wrap"><img id="target" alt="test"><div id="overlay"></div></div>`);
    let blocked = false;
    document.querySelector("#overlay").addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#overlay", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "overlay contextmenu listener still ran");
  },

  async "method-08-overlay-pointer-events"(h) {
    h.setBody(h.overlayFixture("img"));
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "covered image remains pointer-blocked");
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "image overlay still receives pointer events");
  },

  async "method-09-selectstart-event"(h) {
    h.setBody(`<div id="target" style="user-select:none">select this text</div>`);
    let blocked = false;
    h.target().addEventListener("selectstart", event => { blocked = true; event.preventDefault(); });
    await h.settle();
    const event = h.fire("#target", "selectstart");
    h.assert(!blocked && !event.defaultPrevented, "selectstart listener still ran");
    h.assert(getComputedStyle(h.target()).userSelect !== "none", "text remains unselectable");
  },

  async "method-10-selection-survives-release"(h) {
    h.setBody(`<div id="target">selection must survive release</div>`);
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(h.target());
    selection.removeAllRanges();
    selection.addRange(range);
    for (const type of ["mouseup", "keyup", "touchend"]) {
      h.target().addEventListener(type, () => getSelection().removeAllRanges());
      h.fire("#target", type);
      await h.settle();
      h.assert(!getSelection().isCollapsed, `selection was cleared by ${type}`);
    }
  },

  async "method-11-keyboard-copy"(h) {
    h.setBody(`<input id="target" value="copy me">`);
    let blocked = false;
    h.target().addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        blocked = true;
        event.preventDefault();
      }
    });
    const event = h.fire("#target", "keydown", { key: "c", ctrlKey: true });
    h.assert(!blocked && !event.defaultPrevented, "Ctrl/Cmd+C keydown blocker still ran");
  },

  async "method-12-visible-selection"(h) {
    h.setBody(`<style>#fixture span::selection{color:inherit!important;background:transparent!important}</style><div id="target"><span>visible selection</span></div>`);
    const selectionStyle = getComputedStyle(h.target().querySelector("span"), "::selection");
    h.assert(selectionStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && selectionStyle.backgroundColor !== "transparent", "selection highlight remains transparent");
  },

  async "method-13-input-overlay"(h) {
    h.setBody(h.overlayFixture("input"));
    await h.settle();
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "input overlay still receives pointer events");
  },

  async "method-14-paste-rollback"(h) {
    h.setBody(`<input id="target">`);
    let accepted = "";
    h.target().addEventListener("input", event => {
      if (event.target.value.length - accepted.length > 2) event.target.value = accepted;
      else accepted = event.target.value;
    });
    h.target().value = "three";
    h.fire("#target", "input", { inputType: "insertFromPaste", data: "three" });
    h.assert(h.target().value === "three", "input handler rolled pasted content back");
  },

  async "method-15-canvas-overlay"(h) {
    h.setBody(h.overlayFixture("canvas"));
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "canvas remains pointer-blocked");
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "canvas overlay still receives pointer events");
  },

  async "method-16-css-background"(h) {
    h.setBody(`<div id="target" style="background-image:url(data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E)"></div>`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "background contextmenu listener still ran");
    h.assert(getComputedStyle(h.target()).backgroundImage !== "none", "CSS background image was removed");
  }
};
