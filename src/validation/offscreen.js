import {
  buildRepairMessage,
  extractAssistantText,
  parseGeneratedBuild,
  scanGeneratedBuild
} from "../lib/llm.js";

const APPROVED_SCENARIOS = new Set([
  "inline-contextmenu-block",
  "input-contextmenu-listener",
  "paste-event-blocker",
  "image-contextmenu-listener",
  "contextmenu-alert-blocker",
  "media-pointer-events",
  "overlay-contextmenu-listener",
  "image-overlay-pointer-events",
  "selectstart-blocker",
  "selection-survives-release",
  "keyboard-copy-blocker",
  "visible-selection",
  "input-overlay-pointer-events",
  "paste-rollback",
  "canvas-overlay-pointer-events",
  "css-background-contextmenu",
  "ordinary-controls-preserved"
]);
const MAX_GENERATION_ATTEMPTS = 3;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "validation-offscreen" || message.type !== "run-behavior-tests") return;
  void runValidatedSuite(message).then(sendResponse, error => sendResponse({
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
    validateDeclarativeSuite(packageDefinition.tests.suite, packageDefinition.tests.criteria, packageDefinition.skill);
    const messages = [...request.body.messages];
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const response = await fetch(request.endpoint, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${request.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ ...request.body, messages })
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`LLM API request failed (${response.status}): ${detail}`);
      }
      const payload = await response.json();
      const assistantText = extractAssistantText(payload);
      const build = parseGeneratedBuild(assistantText, packageDefinition.skill);
      build.validation = scanGeneratedBuild(build, packageDefinition.skill);
      build.generation = {
        provider: new URL(request.endpoint).origin,
        model: request.model,
        generatedAt: new Date().toISOString(),
        attempts: attempt,
        hash: await sha256(JSON.stringify(build.modes))
      };
      const behaviorResponse = await runSuite({
        suite: packageDefinition.tests.suite,
        build
      });
      const failed = behaviorResponse.results.filter(result => !result.ok);
      if (failed.length === 0) {
        const generatedPackage = {
          skill: packageDefinition.skill,
          build: { ...build, behaviorTests: behaviorResponse.results },
          source: {
            type: "llm",
            packagePath: packageDefinition.source.packagePath,
            skillPath: packageDefinition.source.skillPath,
            buildPath: null
          }
        };
        await chrome.runtime.sendMessage({
          target: "generation-background",
          type: "generation-complete",
          jobId,
          skillId,
          ok: true,
          packageDefinition: generatedPackage
        });
        return;
      }
      if (attempt === MAX_GENERATION_ATTEMPTS) {
        throw new Error(`Generated build failed ${failed.length}/${behaviorResponse.results.length} approved behavior checks after ${attempt} attempts.`);
      }
      const failedCriteria = [...new Set(failed.map(result => result.criterion))];
      messages.push(
        { role: "assistant", content: assistantText },
        { role: "user", content: buildRepairMessage(failedCriteria) }
      );
    }
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

async function runSuite({ suite, build }) {
  const executableTests = suite.tests.filter(test => !test.type);
  const results = [];
  for (const test of executableTests) {
    const artifact = build.modes[test.mode];
    if (!artifact) {
      results.push({ id: test.id, mode: test.mode, ok: false, error: "Build mode is missing." });
      continue;
    }
    const result = await runCase({ test, artifact });
    results.push({ ...result, criterion: test.criterion });
  }
  return { ok: results.every(result => result.ok), results };
}

async function runValidatedSuite({ suite, criteria, skill, build }) {
  validateDeclarativeSuite(suite, criteria, skill);
  return runSuite({ suite, build });
}

function validateDeclarativeSuite(suite, allowedCriteria, skill) {
  if (suite?.schemaVersion !== 2 || !Array.isArray(suite.tests)) {
    throw new Error("MSkill requires declarative acceptance-test schema version 2.");
  }
  if (suite.tests.length === 0 || suite.tests.length > 50) {
    throw new Error("MSkill must contain between 1 and 50 declarative acceptance tests.");
  }
  const criteria = new Set(allowedCriteria);
  const coveredCriteria = new Set();
  const testIds = new Set();
  for (const test of suite.tests) {
    const allowedKeys = test.type
      ? ["id", "type", "capability", "criterion"]
      : ["id", "mode", "scenario", "criterion"];
    if (Object.keys(test).some(key => !allowedKeys.includes(key))) {
      throw new Error(`Acceptance test contains unsupported fields: ${test.id || "unknown"}`);
    }
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(test.id || "")) throw new Error("Acceptance test ID is invalid.");
    if (testIds.has(test.id)) throw new Error(`Acceptance test ID is duplicated: ${test.id}`);
    testIds.add(test.id);
    if (!criteria.has(test.criterion)) throw new Error(`Acceptance test references an undeclared criterion: ${test.id}`);
    coveredCriteria.add(test.criterion);
    if (!test.type) {
      if (!skill.modes.includes(test.mode)) throw new Error(`Acceptance test uses an undeclared mode: ${test.id}`);
      if (!APPROVED_SCENARIOS.has(test.scenario)) throw new Error(`Acceptance test uses an unapproved scenario: ${test.id}`);
    } else {
      if (test.type !== "capabilityDenied") throw new Error(`Acceptance test type is not approved: ${test.id}`);
      if (!skill.forbiddenCapabilities.includes(test.capability)) {
        throw new Error(`Acceptance test denies an undeclared forbidden capability: ${test.id}`);
      }
      if (test.criterion !== `no-${test.capability}`) {
        throw new Error(`Capability-denial test must use criterion no-${test.capability}: ${test.id}`);
      }
    }
  }
  const missingCriteria = [...criteria].filter(criterion => !coveredCriteria.has(criterion));
  if (missingCriteria.length > 0) {
    throw new Error(`Acceptance suite does not cover declared criteria: ${missingCriteria.join(", ")}`);
  }
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
