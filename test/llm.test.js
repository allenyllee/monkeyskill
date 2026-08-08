import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerationMessages,
  endpointOriginPattern,
  extractAssistantText,
  normalizeLlmSettings,
  parseGeneratedBuild,
  scanGeneratedBuild
} from "../src/lib/llm.js";

const skill = {
  id: "example-skill",
  name: "Example",
  version: "1.0.0",
  modes: ["standard"],
  forbiddenCapabilities: ["network", "cookies", "downloads"]
};

test("LLM settings normalize an HTTPS endpoint without exposing provider assumptions", () => {
  const settings = normalizeLlmSettings({
    endpoint: "https://llm.example/v1/chat/completions",
    model: " test-model ",
    apiKey: " secret "
  });
  assert.equal(settings.model, "test-model");
  assert.equal(settings.apiKey, "secret");
  assert.equal(endpointOriginPattern(settings.endpoint), "https://llm.example/*");
});

test("generation prompt includes every declared mode", () => {
  const messages = buildGenerationMessages({
    installerInstructions: "policy",
    skillInstructions: "behavior",
    skill,
    tests: { tests: [] }
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[1].content, /"standard"/);
});

test("generated JSON becomes a user-script build", () => {
  const text = JSON.stringify({
    summary: "Generated",
    modes: { standard: { js: "(() => {})();", css: "body { color: red; }" } }
  });
  const build = parseGeneratedBuild(extractAssistantText({
    choices: [{ message: { content: text } }]
  }), skill);
  assert.equal(build.artifactType, "user-script");
  assert.deepEqual(scanGeneratedBuild(build, skill), [
    "schema", "size", "forbidden-capabilities", "remote-content"
  ]);
});

test("security scan rejects undeclared network access", () => {
  const build = parseGeneratedBuild(JSON.stringify({
    modes: { standard: { js: "fetch('https://example.com')", css: "" } }
  }), skill);
  assert.throws(() => scanGeneratedBuild(build, skill), /forbidden network/);
});
