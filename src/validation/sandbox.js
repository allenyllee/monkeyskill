(() => {
  const nonce = crypto.randomUUID();
  const nativeEval = eval;

  window.addEventListener("message", async event => {
    const message = event.data;
    if (event.source !== parent || message?.type !== "monkeyskill-run-test" || message.nonce !== nonce) return;
    const result = { id: message.test.id, mode: message.test.mode, ok: false };
    try {
      installArtifact(message.artifact);
      const scenario = globalThis.__monkeySkillScenarios?.[message.test.scenario];
      if (typeof scenario !== "function") throw new Error("Approved test scenario is missing.");
      await scenario(createHarness());
      result.ok = true;
    } catch (error) {
      result.error = error.message;
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

  function createHarness() {
    return {
      assert(condition, message) {
        if (!condition) throw new Error(message);
      },
      setBody(html) {
        window.__blocked = false;
        document.querySelector("#fixture").innerHTML = html;
      },
      target() {
        const target = document.querySelector("#target");
        if (!target) throw new Error("Test target is missing.");
        return target;
      },
      fire(selector, type, init = {}) {
        const target = document.querySelector(selector);
        if (!target) throw new Error(`Unable to dispatch ${type}: ${selector} is missing.`);
        let event;
        const options = { bubbles: true, cancelable: true, ...init };
        if (type === "keydown" || type === "keyup") event = new KeyboardEvent(type, options);
        else if (type === "input") event = new InputEvent(type, options);
        else if (["mousedown", "mouseup", "click", "contextmenu"].includes(type)) event = new MouseEvent(type, options);
        else event = new Event(type, options);
        target.dispatchEvent(event);
        return event;
      },
      settle() {
        return new Promise(resolve => setTimeout(resolve, 50));
      },
      overlayFixture(tagName) {
        const attributes = tagName === "input" ? "value='select me'" : "";
        return `<style>#wrap{position:relative;width:240px;height:120px}#target{width:240px;height:120px;pointer-events:none}#overlay{position:absolute;inset:0}</style><div id="wrap"><${tagName} id="target" ${attributes}></${tagName}><div id="overlay"></div></div>`;
      }
    };
  }
})();
