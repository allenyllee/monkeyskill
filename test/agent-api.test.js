import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAgentApiServer } from "../scripts/agent-api.mjs";
import { buildGenerationMessages, extractAssistantText, parseGeneratedBuild, scanGeneratedBuild } from "../src/lib/llm.js";
import { readFile } from "node:fs/promises";

const skill = JSON.parse(await readFile(new URL("../skills/restore-right-click/skill.json", import.meta.url), "utf8"));
const skillInstructions = await readFile(new URL("../skills/restore-right-click/SKILL.md", import.meta.url), "utf8");
const tests = JSON.parse(await readFile(new URL("../skills/restore-right-click/tests/acceptance.json", import.meta.url), "utf8"));

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
        skill,
        tests
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
