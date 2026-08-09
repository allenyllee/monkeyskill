import {
  buildRepairMessage,
  extractAssistantText,
  parseGeneratedBuild,
  scanGeneratedBuild
} from "../lib/llm.js";
import { parseGeneratedTestSpec, validateTestSpec } from "../lib/test-spec.js";

const MAX_GENERATION_ATTEMPTS = 3;
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
    const [initialBuilderText, testSpec] = await Promise.all([
      requestAssistantText(request, request.builderBody),
      generateTestSpec(request, packageDefinition)
    ]);
    let assistantText = initialBuilderText;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const build = parseGeneratedBuild(assistantText, packageDefinition.skill);
      build.validation = scanGeneratedBuild(build, packageDefinition.skill);
      build.generation = {
        provider: new URL(request.endpoint).origin,
        model: request.model,
        testerModel: request.model,
        generatedAt: new Date().toISOString(),
        attempts: attempt,
        hash: await sha256(JSON.stringify(build.modes))
      };
      const behaviorResponse = await runTestSpec({ testSpec, build });
      const failed = behaviorResponse.results.filter(result => !result.ok);
      if (failed.length === 0) {
        const generatedPackage = {
          skill: packageDefinition.skill,
          build: {
            ...build,
            testSpec,
            behaviorTests: behaviorResponse.results
          },
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
        throw new Error(`Generated build failed ${failed.length}/${behaviorResponse.results.length} independent checks after ${attempt} attempts.`);
      }
      builderMessages.push(
        { role: "assistant", content: assistantText },
        { role: "user", content: buildRepairMessage(failed) }
      );
      assistantText = await requestAssistantText(request, {
        ...request.builderBody,
        messages: builderMessages
      });
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

async function generateTestSpec(request, packageDefinition) {
  const messages = [...request.testerBody.messages];
  let lastError;
  for (let attempt = 1; attempt <= MAX_TESTER_ATTEMPTS; attempt += 1) {
    const assistantText = await requestAssistantText(request, {
      ...request.testerBody,
      messages
    });
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

async function requestAssistantText(request, body) {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${request.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`LLM API request failed (${response.status}): ${detail}`);
  }
  return extractAssistantText(await response.json());
}

async function runValidatedTestSpec({ testSpec, criteria, skill, build }) {
  const normalized = validateTestSpec(testSpec, skill, criteria);
  return runTestSpec({ testSpec: normalized, build });
}

async function runTestSpec({ testSpec, build }) {
  const results = [];
  for (const test of testSpec.tests) {
    if (test.kind === "policy") {
      results.push({ criterion: test.criterion, ok: true, category: "policy-state" });
      continue;
    }
    const artifact = build.modes[test.mode];
    if (!artifact) {
      results.push({ criterion: test.criterion, ok: false, category: "dom-state" });
      continue;
    }
    const result = await runCase({ test, artifact });
    results.push({
      criterion: test.criterion,
      ok: Boolean(result.ok),
      category: result.category || "dom-state"
    });
  }
  return { ok: results.every(result => result.ok), results };
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

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
