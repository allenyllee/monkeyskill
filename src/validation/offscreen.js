chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "validation-offscreen" || message.type !== "run-behavior-tests") return;
  void runSuite(message).then(sendResponse, error => sendResponse({
    ok: false,
    error: error.message
  }));
  return true;
});

async function runSuite({ suite, runnerSource, build }) {
  const executableTests = suite.tests.filter(test => !test.type);
  const results = [];
  for (const test of executableTests) {
    const artifact = build.modes[test.mode];
    if (!artifact) {
      results.push({ id: test.id, mode: test.mode, ok: false, error: "Build mode is missing." });
      continue;
    }
    results.push(await runCase({ test, artifact, runnerSource }));
  }
  return { ok: results.every(result => result.ok), results };
}

function runCase(payload) {
  return new Promise(resolve => {
    let sandboxNonce;
    const frame = document.createElement("iframe");
    frame.src = "sandbox.html";
    frame.style.cssText = "width:1024px;height:768px;border:0";
    const timeout = setTimeout(() => finish({
      id: payload.test.id,
      mode: payload.test.mode,
      ok: false,
      error: "Behavior test timed out."
    }), 5000);

    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.data.type === "monkeyskill-sandbox-ready") {
        sandboxNonce = event.data.nonce;
        frame.contentWindow.postMessage({
          type: "monkeyskill-run-test",
          nonce: sandboxNonce,
          ...payload
        }, "*");
      } else if (event.data.type === "monkeyskill-test-result" && event.data.nonce === sandboxNonce) {
        finish(event.data.result);
      }
    }

    function finish(result) {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(result);
    }

    window.addEventListener("message", onMessage);
    document.body.append(frame);
  });
}
