import {
  buildRepairMessage,
  buildSelfTestRepairMessage,
  extractAssistantText,
  parseGeneratedBuild,
  parseGeneratedSelfTests,
  scanGeneratedBuild
} from "../lib/llm.js";
import { parseGeneratedTestSpec, validateTestSpec } from "../lib/test-spec.js";
import {
  MAX_GENERATION_ATTEMPTS,
  createRetryState,
  evaluateGenerationRetry
} from "../lib/generation-policy.js";

const MAX_TESTER_ATTEMPTS = 2;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "validation-offscreen" || message.type !== "run-behavior-tests") return;
  void runValidatedTestSpec(message).then(sendResponse, error => sendResponse({
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
    const builderMessages = [...request.builderBody.messages];
    const builderSessionId = `builder-${jobId}`;
    const testerSessionId = `tester-${jobId}`;
    const [initialBuilderText, testSpec] = await Promise.all([
      requestAssistantText(request, request.builderBody, builderSessionId),
      generateTestSpec(request, packageDefinition, testerSessionId)
    ]);
    let assistantText = initialBuilderText;
    let retryState = createRetryState();

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      let build;
      let selfTests;
      try {
        build = parseGeneratedBuild(assistantText, packageDefinition.skill);
        selfTests = parseGeneratedSelfTests(
          assistantText,
          packageDefinition.skill,
          packageDefinition.criteria
        );
      } catch (error) {
        if (attempt >= MAX_GENERATION_ATTEMPTS) throw error;
        builderMessages.push(
          { role: "assistant", content: assistantText },
          {
            role: "user",
            content: [
              "The candidate JSON or its public selfTests were rejected by the trusted schema validator.",
              `Validator category: ${builderErrorCategory(error.message)}`,
              "Return the complete build and complete selfTests using only the original SKILL.md and shared MonkeyTest framework."
            ].join("\n")
          }
        );
        assistantText = await requestAssistantText(request, {
          ...request.builderBody,
          messages: builderMessages
        }, builderSessionId);
        continue;
      }
      build.validation = scanGeneratedBuild(build, packageDefinition.skill);
      const buildHash = await sha256(JSON.stringify(build.modes));
      const candidateHash = await sha256(JSON.stringify({ modes: build.modes, selfTests }));
      build.generation = {
        provider: new URL(request.endpoint).origin,
        model: request.model,
        testerModel: request.model,
        generatedAt: new Date().toISOString(),
        attempts: attempt,
        hash: buildHash
      };
      const selfTestResponse = await runTestSpec({ testSpec: selfTests, build, publicDiagnostics: true });
      const failedSelfTests = selfTestResponse.results.filter(result => !result.ok && !result.inconclusive);
      if (failedSelfTests.length > 0) {
        const retryDecision = evaluateGenerationRetry(retryState, {
          attempt,
          hash: candidateHash,
          failures: failedSelfTests
        });
        retryState = retryDecision.state;
        if (!retryDecision.retry) {
          const detail = failedSelfTests.map(formatLocalFailure).join("; ");
          throw new Error(`Builder self-tests failed ${failedSelfTests.length}/${selfTestResponse.results.length} checks after ${attempt} attempts (${retryDecision.reason}): ${detail}`);
        }
        builderMessages.push(
          { role: "assistant", content: assistantText },
          { role: "user", content: buildSelfTestRepairMessage(failedSelfTests) }
        );
        assistantText = await requestAssistantText(request, {
          ...request.builderBody,
          messages: builderMessages
        }, builderSessionId);
        continue;
      }
      const behaviorResponse = await runTestSpec({ testSpec, build });
      const failed = behaviorResponse.results.filter(result => !result.ok && !result.inconclusive);
      if (failed.length === 0) {
        const generatedPackage = {
          skill: packageDefinition.skill,
          specification: packageDefinition.specification,
          build: {
            ...build,
            selfTests,
            selfTestResults: selfTestResponse.results,
            testSpec,
            behaviorTests: behaviorResponse.results,
            runnerCapabilities: behaviorResponse.capabilities
          },
          source: {
            type: "llm",
            packagePath: packageDefinition.source.packagePath,
            skillPath: packageDefinition.source.skillPath,
            buildPath: null,
            storeUrl: packageDefinition.source.storeUrl
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
      const retryDecision = evaluateGenerationRetry(retryState, {
        attempt,
        hash: candidateHash,
        failures: failed
      });
      retryState = retryDecision.state;
      if (!retryDecision.retry) {
        const detail = failed.map(formatLocalFailure).join("; ");
        throw new Error(`Generated build failed ${failed.length}/${behaviorResponse.results.length} independent checks after ${attempt} attempts (${retryDecision.reason}): ${detail}`);
      }
      builderMessages.push(
        { role: "assistant", content: assistantText },
        { role: "user", content: buildRepairMessage(failed) }
      );
      assistantText = await requestAssistantText(request, {
        ...request.builderBody,
        messages: builderMessages
      }, builderSessionId);
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

async function generateTestSpec(request, packageDefinition, sessionId) {
  const messages = [...request.testerBody.messages];
  let lastError;
  for (let attempt = 1; attempt <= MAX_TESTER_ATTEMPTS; attempt += 1) {
    const assistantText = await requestAssistantText(request, {
      ...request.testerBody,
      messages
    }, sessionId);
    try {
      return parseGeneratedTestSpec(assistantText, packageDefinition.skill, packageDefinition.criteria);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_TESTER_ATTEMPTS) {
        messages.push(
          { role: "assistant", content: assistantText },
          {
            role: "user",
            content: [
              "The TestSpec was rejected by the trusted schema validator.",
              `Validator category: ${testerErrorCategory(error.message)}`,
              "Return a complete corrected TestSpec using only the original SKILL.md and the allowed DSL."
            ].join("\n")
          }
        );
      }
    }
  }
  throw lastError;
}

async function requestAssistantText(request, body, sessionId) {
  const headers = {
    "authorization": `Bearer ${request.apiKey}`,
    "content-type": "application/json"
  };
  if (isLocalAgentEndpoint(request.endpoint)) headers["x-monkeyskill-session"] = sessionId;
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`LLM API request failed (${response.status}): ${detail}`);
  }
  return extractAssistantText(await response.json());
}

function isLocalAgentEndpoint(endpoint) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

async function runValidatedTestSpec({ testSpec, criteria, skill, build }) {
  const normalized = validateTestSpec(testSpec, skill, criteria);
  return runTestSpec({ testSpec: normalized, build });
}

async function runTestSpec({ testSpec, build, publicDiagnostics = false }) {
  const capabilities = await runCapabilitySelfTests(testSpec);
  const results = [];
  for (const test of testSpec.tests) {
    if (test.kind === "policy") {
      results.push({ criterion: test.criterion, ok: true, category: "policy-state" });
      continue;
    }
    const unsupportedCapability = requiredCapabilities(test).find(capability => !capabilities[capability]?.ok);
    if (unsupportedCapability) {
      results.push({
        criterion: test.criterion,
        ok: false,
        inconclusive: true,
        category: unsupportedCapability === "focus"
          ? "focus-state"
          : unsupportedCapability === "hit-test" ? "visibility-state" : "dom-state",
        capability: unsupportedCapability
      });
      continue;
    }
    const artifact = build.modes[test.mode];
    if (!artifact) {
      results.push({ criterion: test.criterion, ok: false, category: "dom-state" });
      continue;
    }
    const result = await runCase({ test, artifact });
    const testResult = {
      criterion: test.criterion,
      mode: test.mode,
      ok: Boolean(result.ok),
      category: result.category || "dom-state",
      assertion: result.assertion || null,
      diagnostic: result.diagnostic || null
    };
    if (publicDiagnostics) {
      testResult.testId = test.id;
      testResult.trace = Array.isArray(result.trace) ? result.trace : [];
    }
    results.push(testResult);
  }
  return {
    ok: results.every(result => result.ok || result.inconclusive),
    results,
    capabilities
  };
}

async function runCapabilitySelfTests(testSpec) {
  const names = new Set(testSpec.tests.flatMap(requiredCapabilities));
  const entries = await Promise.all([...names].map(async capability => [
    capability,
    await runCase({ capability })
  ]));
  return Object.fromEntries(entries);
}

function requiredCapabilities(test) {
  if (test.kind !== "behavior") return [];
  const capabilities = [];
  if (test.assertions.some(assertion => assertion.type === "active-element")) capabilities.push("focus");
  if (test.assertions.some(assertion => assertion.type === "hit-test")) capabilities.push("hit-test");
  if (test.steps.some(step => step.action === "drag-select-text")) capabilities.push("drag-select-text");
  if (test.steps.some(step => step.action === "copy-shortcut")) capabilities.push("copy-shortcut");
  return capabilities;
}

function formatLocalFailure(failure) {
  const diagnostic = failure.diagnostic;
  if (!diagnostic) return `${failure.criterion}:${failure.category}`;
  return `${failure.criterion}:${failure.category} (${diagnostic.property} actual=${JSON.stringify(diagnostic.actual)} ${diagnostic.operator} expected=${JSON.stringify(diagnostic.expected)})`;
}

function runCase(payload) {
  return new Promise(resolve => {
    let sandboxNonce;
    const frame = document.createElement("iframe");
    frame.src = "sandbox.html";
    frame.style.cssText = "width:1024px;height:768px;border:0";
    const timeout = setTimeout(() => finish({ ok: false, category: "dom-state" }), 5000);

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

function testerErrorCategory(message) {
  if (/criterion/i.test(message)) return "criterion-mapping";
  if (/fixture|node|tag|attribute|style/i.test(message)) return "fixture-schema";
  if (/blocker|event/i.test(message)) return "blocker-schema";
  if (/step|action/i.test(message)) return "step-schema";
  if (/assertion/i.test(message)) return "assertion-schema";
  return "testspec-schema";
}

function builderErrorCategory(message) {
  if (/selfTests|TestSpec/i.test(message)) return testerErrorCategory(message);
  if (/JavaScript|CSS|mode|build/i.test(message)) return "build-schema";
  return "candidate-schema";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
