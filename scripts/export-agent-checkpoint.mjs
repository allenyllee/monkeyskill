import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [bootstrapPath, outputPath, testerSession, attackerSession, testerBSession, builderSession, builderContentPath] = process.argv.slice(2);
if (![bootstrapPath, outputPath, testerSession, attackerSession, testerBSession, builderSession, builderContentPath].every(Boolean)) {
  throw new Error("Usage: node scripts/export-agent-checkpoint.mjs <bootstrap> <output> <tester-session> <attacker-session> <tester-b-session> <builder-session> <builder-content>");
}

const resolvedOutput = path.resolve(outputPath);
const workspace = process.cwd() + path.sep;
if (!resolvedOutput.startsWith(workspace) || !path.basename(resolvedOutput).startsWith(".tmp-")) {
  throw new Error("Checkpoint output must be a .tmp-* file inside the workspace.");
}

const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
const headers = { authorization: `Bearer ${bootstrap.token}` };
const endpoint = new URL(bootstrap.workerEndpoint || bootstrap.endpoint);
endpoint.port = "8788";

async function readSession(id) {
  const response = await fetch(new URL(`/sessions/${encodeURIComponent(id)}`, endpoint), { headers });
  if (!response.ok) throw new Error(`Session ${id} unavailable (${response.status}).`);
  return response.json();
}

function roleCheckpoint(session, contentOverride) {
  const request = session.turns.find(turn => turn.role === "request");
  const assistant = session.turns.filter(turn => turn.role === "assistant").at(-1);
  if (!request?.messages || (!assistant?.content && !contentOverride)) throw new Error(`Session ${session.id} is incomplete.`);
  const input = JSON.stringify(request.messages);
  return {
    sourceSession: session.id,
    inputHash: createHash("sha256").update(input).digest("hex"),
    messages: request.messages,
    content: contentOverride ?? assistant.content
  };
}

const [tester, attacker, testerB, builder] = await Promise.all([
  readSession(testerSession), readSession(attackerSession), readSession(testerBSession), readSession(builderSession)
]);
const builderContent = await readFile(builderContentPath, "utf8");
const checkpoint = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  roles: {
    "tester-original": roleCheckpoint(tester),
    attacker: roleCheckpoint(attacker),
    "tester-adversarial": roleCheckpoint(testerB),
    builder: roleCheckpoint(builder, builderContent)
  }
};
await writeFile(resolvedOutput, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ output: resolvedOutput, roles: Object.fromEntries(Object.entries(checkpoint.roles).map(([role, value]) => [role, value.inputHash])) }));
