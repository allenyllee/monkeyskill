import {
  extractAssistantText,
  parseGeneratedBuild,
  scanGeneratedBuild
} from "../lib/llm.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "validation-offscreen" || message.type !== "run-behavior-tests") return;
  void runSuite(message).then(sendResponse, error => sendResponse({
    ok: false,
    error: error.message
  }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "validation-offscreen" || message.type !== "generate-package") return;
  void runGenerationJob(message);
  sendResponse({ ok: true });
  return false;
});

async function runGenerationJob({ jobId, skillId, packageDefinition, request }) {
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${request.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request.body)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`LLM API request failed (${response.status}): ${detail}`);
    }
    const payload = await response.json();
    const build = parseGeneratedBuild(extractAssistantText(payload), packageDefinition.skill);
    build.validation = scanGeneratedBuild(build, packageDefinition.skill);
    build.generation = {
      provider: new URL(request.endpoint).origin,
      model: request.model,
      generatedAt: new Date().toISOString(),
      hash: await sha256(JSON.stringify(build.modes))
    };
    const generatedPackage = {
      skill: packageDefinition.skill,
      build,
      source: {
        type: "llm",
        packagePath: packageDefinition.source.packagePath,
        skillPath: packageDefinition.source.skillPath,
        buildPath: null
      }
    };
    const behaviorResponse = await runSuite({
      suite: packageDefinition.tests.suite,
      runnerSource: packageDefinition.tests.runnerSource,
      build
    });
    const failed = behaviorResponse.results.filter(result => !result.ok);
    if (failed.length > 0) {
      const detail = failed.map(result => `${result.id}: ${result.error}`).join("; ");
      throw new Error(`Generated build failed behavior tests (${failed.length}/${behaviorResponse.results.length}): ${detail}`);
    }
    generatedPackage.build.behaviorTests = behaviorResponse.results;
    await chrome.runtime.sendMessage({
      target: "generation-background",
      type: "generation-complete",
      jobId,
      skillId,
      ok: true,
      packageDefinition: generatedPackage
    });
  } catch (error) {
    await chrome.runtime.sendMessage({
      target: "generation-background",
      type: "generation-complete",
      jobId,
      skillId,
      ok: false,
      error: error.message
    });
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

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
