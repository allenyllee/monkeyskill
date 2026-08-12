import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const bootstrapPath = process.argv[2] || ".tmp-clean-agent-bootstrap.json";
const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
const clientEndpoint = new URL(bootstrap.endpoint);
const workerEndpoint = new URL(bootstrap.workerEndpoint || bootstrap.endpoint);
if (!bootstrap.workerEndpoint) workerEndpoint.port = process.env.MONKEYSKILL_AGENT_WORKER_PORT || "8788";

const headers = { authorization: `Bearer ${bootstrap.token}` };
await assertHealthy(clientEndpoint, "client");
await assertHealthy(workerEndpoint, "worker");

const runId = randomUUID();
await Promise.all([
  roundTrip("attacker", [{ role: "system", content: "name: mskill-attacker" }]),
  roundTrip("builder", [{ role: "system", content: "name: mskill-installer" }]),
  roundTrip("tester", [{ role: "system", content: "name: mskill-tester" }])
]);

console.log(`Agent API preflight passed: client=${clientEndpoint.origin}, worker=${workerEndpoint.origin}`);

async function assertHealthy(endpoint, label) {
  const response = await fetch(new URL("/health", endpoint));
  if (!response.ok) throw new Error(`${label} health failed (${response.status})`);
  const health = await response.json();
  if (!health.ok || health.mode !== "subagent") throw new Error(`${label} is not a subagent API`);
}

async function roundTrip(role, systemMessages) {
  const sessionId = `preflight-${role}-${runId}`;
  const worker = `preflight-${role}-${runId}`;
  const completionPromise = fetch(new URL("/v1/chat/completions", clientEndpoint), {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      "x-monkeyskill-session": sessionId
    },
    body: JSON.stringify({
      model: "preflight-model",
      messages: [...systemMessages, { role: "user", content: "Transport preflight only." }]
    })
  });

  const jobResponse = await fetch(new URL(`/agent/jobs/next?role=${role}&worker=${worker}&wait=30000`, workerEndpoint), { headers });
  if (jobResponse.status !== 200) throw new Error(`${role} worker did not receive its preflight job (${jobResponse.status})`);
  const job = await jobResponse.json();
  if (job.role !== role || job.sessionId !== sessionId) throw new Error(`${role} worker received the wrong preflight job`);

  const completed = await fetch(new URL(`/agent/jobs/${encodeURIComponent(job.id)}/complete`, workerEndpoint), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ worker, content: JSON.stringify({ preflight: true, role }) })
  });
  if (!completed.ok) throw new Error(`${role} completion failed (${completed.status})`);

  const response = await completionPromise;
  if (!response.ok) throw new Error(`${role} client request failed (${response.status})`);
  const payload = await response.json();
  if (!payload?.choices?.[0]?.message?.content) throw new Error(`${role} response did not contain assistant content`);
}
