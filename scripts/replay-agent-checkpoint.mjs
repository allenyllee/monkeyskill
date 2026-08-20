import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [bootstrapPath, checkpointPath, roleName, worker, mismatchOutput] = process.argv.slice(2);
const roleMap = { "tester-original": "tester", attacker: "attacker", "tester-adversarial": "tester", builder: "builder" };
if (!bootstrapPath || !checkpointPath || !roleMap[roleName] || !worker || !mismatchOutput) {
  throw new Error("Usage: node scripts/replay-agent-checkpoint.mjs <bootstrap> <checkpoint> <tester-original|attacker|tester-adversarial|builder> <worker> <mismatch-output>");
}
const mismatchPath = path.resolve(mismatchOutput);
const workspace = process.cwd() + path.sep;
if (!mismatchPath.startsWith(workspace) || !path.basename(mismatchPath).startsWith(".tmp-")) {
  throw new Error("Mismatch output must be a .tmp-* file inside the workspace.");
}

const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
const cached = checkpoint.roles?.[roleName];
if (!cached) throw new Error(`Checkpoint has no ${roleName} role.`);
const headers = { authorization: `Bearer ${bootstrap.token}`, "content-type": "application/json" };
const endpoint = new URL(bootstrap.workerEndpoint || bootstrap.endpoint);
endpoint.port = "8788";
let job = null;
for (let index = 0; index < 120 && !job; index += 1) {
  const response = await fetch(new URL(`/agent/jobs/next?role=${roleMap[roleName]}&worker=${encodeURIComponent(worker)}&wait=1000`, endpoint), { headers });
  if (response.status === 200) job = await response.json();
  else if (response.status !== 204) throw new Error(`Worker poll failed (${response.status}).`);
}
if (!job) throw new Error(`No ${roleName} job arrived.`);

const input = JSON.stringify(job.request?.messages);
const inputHash = createHash("sha256").update(input).digest("hex");
if (inputHash !== cached.inputHash) {
  await writeFile(mismatchPath, `${JSON.stringify({ schemaVersion: 1, roleName, worker, job, inputHash, expectedHash: cached.inputHash })}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ replayed: false, roleName, jobId: job.id, routingKey: job.routingKey, inputHash, expectedHash: cached.inputHash, mismatchOutput: mismatchPath }));
  process.exitCode = 3;
} else {
  const response = await fetch(new URL(`/agent/jobs/${encodeURIComponent(job.id)}/complete`, endpoint), {
    method: "POST",
    headers,
    body: JSON.stringify({ worker, content: cached.content })
  });
  console.log(JSON.stringify({ replayed: true, roleName, jobId: job.id, routingKey: job.routingKey, inputHash, completionStatus: response.status, body: await response.text() }));
  if (!response.ok) process.exitCode = 2;
}
