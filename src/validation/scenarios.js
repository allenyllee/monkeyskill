globalThis.__monkeySkillScenarios = Object.freeze({
  async "inline-contextmenu-block"(h) {
    h.setBody(`<div id="target" oncontextmenu="window.__blocked=true; return false" onmousedown="if(event.button===2){window.__blocked=true; return false}">target</div>`);
    await h.settle();
    h.fire("#target", "mousedown", { button: 2 });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!window.__blocked && !event.defaultPrevented, "inline right-click handlers still ran");
  },

  async "input-contextmenu-listener"(h) {
    h.setBody(`<input id="target">`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "input contextmenu listener still ran");
  },

  async "paste-event-blocker"(h) {
    h.setBody(`<input id="target">`);
    let blocked = false;
    h.target().addEventListener("paste", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "paste");
    h.assert(!blocked && !event.defaultPrevented, "paste listener still ran");
  },

  async "image-contextmenu-listener"(h) {
    h.setBody(`<img id="target" alt="test">`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "image contextmenu listener still ran");
  },

  async "contextmenu-alert-blocker"(h) {
    h.setBody(`<div id="target">target</div>`);
    let alerted = false;
    h.target().addEventListener("contextmenu", event => { alerted = true; event.preventDefault(); });
    h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!alerted, "right-click alert handler still ran");
  },

  async "media-pointer-events"(h) {
    h.setBody(`<img id="target" style="pointer-events:none" alt="test">`);
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "media pointer-events remains none");
  },

  async "overlay-contextmenu-listener"(h) {
    h.setBody(`<div id="wrap"><img id="target" alt="test"><div id="overlay"></div></div>`);
    let blocked = false;
    document.querySelector("#overlay").addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#overlay", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "overlay contextmenu listener still ran");
  },

  async "image-overlay-pointer-events"(h) {
    h.setBody(h.overlayFixture("img"));
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "covered image remains pointer-blocked");
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "image overlay still receives pointer events");
  },

  async "selectstart-blocker"(h) {
    h.setBody(`<div id="target" style="user-select:none">select this text</div>`);
    let blocked = false;
    h.target().addEventListener("selectstart", event => { blocked = true; event.preventDefault(); });
    await h.settle();
    const event = h.fire("#target", "selectstart");
    h.assert(!blocked && !event.defaultPrevented, "selectstart listener still ran");
    h.assert(getComputedStyle(h.target()).userSelect !== "none", "text remains unselectable");
  },

  async "selection-survives-release"(h) {
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

  async "keyboard-copy-blocker"(h) {
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

  async "visible-selection"(h) {
    h.setBody(`<style>#fixture span::selection{color:inherit!important;background:transparent!important}</style><div id="target"><span>visible selection</span></div>`);
    const selectionStyle = getComputedStyle(h.target().querySelector("span"), "::selection");
    h.assert(selectionStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && selectionStyle.backgroundColor !== "transparent", "selection highlight remains transparent");
  },

  async "input-overlay-pointer-events"(h) {
    h.setBody(h.overlayFixture("input"));
    await h.settle();
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "input overlay still receives pointer events");
  },

  async "paste-rollback"(h) {
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

  async "canvas-overlay-pointer-events"(h) {
    h.setBody(h.overlayFixture("canvas"));
    await h.settle();
    h.assert(getComputedStyle(h.target()).pointerEvents !== "none", "canvas remains pointer-blocked");
    h.assert(getComputedStyle(document.querySelector("#overlay")).pointerEvents === "none", "canvas overlay still receives pointer events");
  },

  async "css-background-contextmenu"(h) {
    h.setBody(`<div id="target" style="background-image:linear-gradient(red,blue)"></div>`);
    let blocked = false;
    h.target().addEventListener("contextmenu", event => { blocked = true; event.preventDefault(); });
    const event = h.fire("#target", "contextmenu", { button: 2 });
    h.assert(!blocked && !event.defaultPrevented, "background contextmenu listener still ran");
    h.assert(h.target().style.backgroundImage.includes("linear-gradient"), "CSS background image declaration was removed");
  },

  async "ordinary-controls-preserved"(h) {
    h.setBody(`<button id="target">button</button><input id="control" value="editable"><a id="link" href="#safe">link</a>`);
    let clicks = 0;
    h.target().addEventListener("click", () => { clicks += 1; });
    const down = h.fire("#target", "mousedown", { button: 0 });
    const click = h.fire("#target", "click", { button: 0 });
    h.assert(clicks === 1 && !down.defaultPrevented && !click.defaultPrevented, "ordinary left-click behavior was blocked");
    h.assert(getComputedStyle(document.querySelector("#control")).pointerEvents !== "none", "editable control was pointer-blocked");
    h.assert(getComputedStyle(document.querySelector("#link")).pointerEvents !== "none", "ordinary link was pointer-blocked");
  }
});
