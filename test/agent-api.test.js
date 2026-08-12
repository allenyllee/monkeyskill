import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAgentApiServer, runFixtureAgent } from "../scripts/agent-api.mjs";
import { buildGenerationMessages, buildTesterMessages, extractAssistantText, extractCriterionIds, extractSharedTestFramework, parseGeneratedBuild, parseGeneratedPublicTestSpec, scanGeneratedBuild } from "../src/lib/llm.js";
import { parseTesterSecurityReview } from "../src/lib/test-spec.js";
import { readFile } from "node:fs/promises";

const skill = JSON.parse(await readFile(new URL("fixtures/sample-skill/skill.json", import.meta.url), "utf8"));
const skillInstructions = await readFile(new URL("fixtures/sample-skill/SKILL.md", import.meta.url), "utf8");
const installerInstructions = await readFile(new URL("../skills/mskill-installer/SKILL.md", import.meta.url), "utf8");
const testerInstructions = await readFile(new URL("../skills/mskill-tester/SKILL.md", import.meta.url), "utf8");
const attackerInstructions = await readFile(new URL("../skills/mskill-attacker/SKILL.md", import.meta.url), "utf8");
import { buildAttackerMessages } from "../src/lib/security-regression.js";

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
        installerInstructions,
        testFrameworkInstructions: extractSharedTestFramework(testerInstructions),
        skillInstructions,
        skill
      })
    })
  });

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-monkeyskill-agent-session"));
  const assistantText = extractAssistantText(await response.json());
  const build = parseGeneratedBuild(assistantText, skill);
  const publicTestSpec = parseGeneratedPublicTestSpec(assistantText, skill, extractCriterionIds(skillInstructions));
  assert.deepEqual(scanGeneratedBuild(build, skill), [
    "schema", "size", "forbidden-capabilities", "remote-content"
  ]);
  assert.deepEqual(Object.keys(build.modes), ["standard"]);
  assert.ok(publicTestSpec.tests.length > 0);
  assert.equal(local.sessions.size, 1);
});

test("local fixture agent independently returns a constrained TestSpec", async () => {
  const response = await runFixtureAgent({
    model: "local-agent",
    messages: buildTesterMessages({
      testerInstructions,
      skillInstructions,
      skill
    })
  });
  const review = parseTesterSecurityReview(
    extractAssistantText(response),
    skill,
    extractCriterionIds(skillInstructions)
  );
  assert.equal(review.verdict, "allow");
  const spec = review.testSpec;
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
      testFrameworkInstructions: extractSharedTestFramework(testerInstructions),
      skillInstructions,
      skill
    })
  };

  const completionPromise = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer queue-token", "content-type": "application/json", "x-monkeyskill-session": "builder-run" },
    body: JSON.stringify(request)
  });
  const jobResponse = await fetch(`http://127.0.0.1:${port}/agent/jobs/next?role=builder&worker=builder-1&wait=1000`, {
    headers: { authorization: "Bearer queue-token" }
  });
  assert.equal(jobResponse.status, 200);
  const job = await jobResponse.json();
  assert.equal(job.role, "builder");
  assert.equal(job.routingKey, "builder:builder-run");
  assert.equal(job.request.model, "codex-subagent");

  const fixtureCompletion = await runFixtureAgent(job.request);
  const workerResponse = await fetch(`http://127.0.0.1:${port}/agent/jobs/${job.id}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer queue-token", "content-type": "application/json" },
    body: JSON.stringify({ worker: "builder-1", content: fixtureCompletion.choices[0].message.content })
  });
  assert.equal(workerResponse.status, 200);
  const completion = await completionPromise;
  assert.equal(completion.status, 200);
  assert.ok(completion.headers.get("x-monkeyskill-agent-session"));
});

test("subagent workers are role-isolated and Builder repairs keep sticky routing", async t => {
  const local = createAgentApiServer({ mode: "subagent", token: "role-token", agentTimeoutMs: 5_000 });
  local.server.listen(0, "127.0.0.1");
  await once(local.server, "listening");
  t.after(() => local.server.close());
  const { port } = local.server.address();
  const builderRequest = {
    model: "codex-subagent",
    messages: buildGenerationMessages({
      installerInstructions,
      testFrameworkInstructions: extractSharedTestFramework(testerInstructions),
      skillInstructions,
      skill
    })
  };
  const testerRequest = {
    model: "codex-subagent",
    messages: buildTesterMessages({ testerInstructions, skillInstructions, skill })
  };
  const submit = (body, session) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer role-token",
      "content-type": "application/json",
      "x-monkeyskill-session": session
    },
    body: JSON.stringify(body)
  });
  const take = (role, worker, wait = 1000) => fetch(
    `http://127.0.0.1:${port}/agent/jobs/next?role=${role}&worker=${worker}&wait=${wait}`,
    { headers: { authorization: "Bearer role-token" } }
  );
  const complete = (job, worker, content) => fetch(`http://127.0.0.1:${port}/agent/jobs/${job.id}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer role-token", "content-type": "application/json" },
    body: JSON.stringify({ worker, content })
  });

  const builderCompletion = submit(builderRequest, "generation-1");
  const testerCannotTakeBuilder = await take("tester", "tester-1", 1);
  assert.equal(testerCannotTakeBuilder.status, 204);
  const builderJobResponse = await take("builder", "builder-1");
  const builderJob = await builderJobResponse.json();
  assert.equal(builderJob.role, "builder");
  assert.equal(builderJob.routingKey, "builder:generation-1");
  assert.equal((await complete(builderJob, "builder-1", "builder initial")).status, 200);
  assert.equal((await builderCompletion).status, 200);

  const testerCompletion = submit(testerRequest, "tester-generation-1");
  const builderCannotTakeTester = await take("builder", "builder-1", 1);
  assert.equal(builderCannotTakeTester.status, 204);
  const testerJobResponse = await take("tester", "tester-1");
  const testerJob = await testerJobResponse.json();
  assert.equal(testerJob.role, "tester");
  assert.equal((await complete(testerJob, "tester-1", "tester spec")).status, 200);
  assert.equal((await testerCompletion).status, 200);

  const repairRequest = {
    ...builderRequest,
    messages: [
      ...builderRequest.messages,
      { role: "assistant", content: "builder initial" },
      { role: "user", content: "Fixed diagnostic category only." }
    ]
  };
  const repairCompletion = submit(repairRequest, "generation-1");
  const otherBuilderCannotSteal = await take("builder", "builder-2", 1);
  assert.equal(otherBuilderCannotSteal.status, 204);
  const repairJobResponse = await take("builder", "builder-1");
  const repairJob = await repairJobResponse.json();
  assert.equal(repairJob.routingKey, builderJob.routingKey);
  assert.equal((await complete(repairJob, "builder-2", "stolen repair")).status, 409);
  assert.equal((await complete(repairJob, "builder-1", "builder repair")).status, 200);
  assert.equal((await repairCompletion).status, 200);
  assert.equal(local.sessions.get("generation-1").turns.length, 4);
  assert.equal(local.sessions.get("tester-generation-1").turns.length, 2);
});

test("Attacker jobs are isolated from Builder and Tester queues", async t => {
  const local = createAgentApiServer({ mode: "subagent", token: "attack-token", agentTimeoutMs: 5_000 });
  local.server.listen(0, "127.0.0.1");
  await once(local.server, "listening");
  t.after(() => local.server.close());
  const { port } = local.server.address();
  const request = {
    model: "codex-subagent",
    messages: buildAttackerMessages({ attackerInstructions, skillInstructions, skill })
  };
  const completion = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer attack-token", "content-type": "application/json", "x-monkeyskill-session": "attack-1" },
    body: JSON.stringify(request)
  });
  for (const role of ["builder", "tester"]) {
    const response = await fetch(`http://127.0.0.1:${port}/agent/jobs/next?role=${role}&worker=${role}-1&wait=1`, {
      headers: { authorization: "Bearer attack-token" }
    });
    assert.equal(response.status, 204);
  }
  const attackerResponse = await fetch(`http://127.0.0.1:${port}/agent/jobs/next?role=attacker&worker=attacker-1&wait=1000`, {
    headers: { authorization: "Bearer attack-token" }
  });
  assert.equal(attackerResponse.status, 200);
  const job = await attackerResponse.json();
  assert.equal(job.role, "attacker");
  assert.equal(job.routingKey, "attacker:attack-1");
  const completed = await fetch(`http://127.0.0.1:${port}/agent/jobs/${job.id}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer attack-token", "content-type": "application/json" },
    body: JSON.stringify({ worker: "attacker-1", content: JSON.stringify({
      schemaVersion: 3,
      framing: "compatibility",
      consequence: "stored-data-export",
      structure: "section"
    }) })
  });
  assert.equal(completed.status, 200);
  assert.equal((await completion).status, 200);
});
