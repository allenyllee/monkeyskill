import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAgentApiServer, runFixtureAgent } from "../scripts/agent-api.mjs";
import { buildGenerationMessages, buildTesterMessages, extractAssistantText, extractCriterionIds, parseGeneratedBuild, scanGeneratedBuild } from "../src/lib/llm.js";
import { parseGeneratedTestSpec } from "../src/lib/test-spec.js";
import { readFile } from "node:fs/promises";

const skill = JSON.parse(await readFile(new URL("../skills/restore-right-click/skill.json", import.meta.url), "utf8"));
const skillInstructions = await readFile(new URL("../skills/restore-right-click/SKILL.md", import.meta.url), "utf8");

test("local fixture agent completes the generation and validation flow", async t => {
  const local = createAgentApiServer({ token: "test-token" });
  local.server.listen(0, "127.0.0.1");
  await once(local.server, "listening");
  t.after(() => local.server.close());
  const { port } = local.server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({
      model: "local-agent",
      messages: buildGenerationMessages({
        installerInstructions: "Generate only the requested safe user script.",
        skillInstructions,
        skill
      })
    })
  });

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-monkeyskill-agent-session"));
  const build = parseGeneratedBuild(extractAssistantText(await response.json()), skill);
  assert.deepEqual(scanGeneratedBuild(build, skill), [
    "schema", "size", "forbidden-capabilities", "remote-content"
  ]);
  assert.deepEqual(Object.keys(build.modes), ["standard", "absolute"]);
  assert.equal(local.sessions.size, 1);
});

test("local fixture agent independently returns a constrained TestSpec", async () => {
  const response = await runFixtureAgent({
    model: "local-agent",
    messages: buildTesterMessages({
      testerInstructions: "# MSkill Tester\nGenerate an independent TestSpec.",
      skillInstructions,
      skill
    })
  });
  const spec = parseGeneratedTestSpec(
    extractAssistantText(response),
    skill,
    extractCriterionIds(skillInstructions)
  );
  assert.ok(spec.tests.some(test => test.kind === "behavior"));
  assert.ok(spec.tests.some(test => test.kind === "policy"));
});

test("local agent API rejects an incorrect token", async t => {
  const local = createAgentApiServer({ token: "correct" });
  local.server.listen(0, "127.0.0.1");
  await once(local.server, "listening");
  t.after(() => local.server.close());
  const { port } = local.server.address();
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
    headers: { authorization: "Bearer wrong" }
  });
  assert.equal(response.status, 401);
});

test("subagent mode queues a request and returns the worker's fresh completion", async t => {
  const local = createAgentApiServer({ mode: "subagent", token: "queue-token", agentTimeoutMs: 5_000 });
  local.server.listen(0, "127.0.0.1");
  await once(local.server, "listening");
  t.after(() => local.server.close());
  const { port } = local.server.address();
  const request = {
    model: "codex-subagent",
    messages: buildGenerationMessages({
      installerInstructions: "Generate only the requested safe user script.",
      skillInstructions,
      skill
    })
  };

  const completionPromise = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer queue-token", "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const jobResponse = await fetch(`http://127.0.0.1:${port}/agent/jobs/next?wait=1000`, {
    headers: { authorization: "Bearer queue-token" }
  });
  assert.equal(jobResponse.status, 200);
  const job = await jobResponse.json();
  assert.equal(job.request.model, "codex-subagent");

  const fixtureCompletion = await runFixtureAgent(job.request);
  const workerResponse = await fetch(`http://127.0.0.1:${port}/agent/jobs/${job.id}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer queue-token", "content-type": "application/json" },
    body: JSON.stringify({ content: fixtureCompletion.choices[0].message.content })
  });
  assert.equal(workerResponse.status, 200);
  const completion = await completionPromise;
  assert.equal(completion.status, 200);
  assert.ok(completion.headers.get("x-monkeyskill-agent-session"));
});
