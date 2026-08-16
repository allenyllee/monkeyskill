import { createAgentApiServer, DEFAULT_SUBAGENT_TIMEOUT_MS } from "./agent-api.mjs";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const option = name => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const host = "127.0.0.1";
const port = Number(option("--port") || process.env.MONKEYSKILL_AGENT_PORT || 8787);
const mode = option("--mode") || process.env.MONKEYSKILL_AGENT_MODE || "fixture";
const bootstrapPath = option("--bootstrap") || process.env.MONKEYSKILL_AGENT_BOOTSTRAP;
const bootstrap = bootstrapPath
  ? JSON.parse(readFileSync(bootstrapPath, "utf8"))
  : null;
const { server, token } = createAgentApiServer({
  mode,
  token: process.env.MONKEYSKILL_LOCAL_TOKEN || bootstrap?.token,
  agentTimeoutMs: Number(process.env.MONKEYSKILL_AGENT_TIMEOUT_MS || bootstrap?.agentTimeoutMs || DEFAULT_SUBAGENT_TIMEOUT_MS)
});

server.listen(port, host, () => {
  console.log(`MonkeySkill agent API: http://${host}:${port}/v1/chat/completions`);
  console.log(`Mode: ${mode}`);
  console.log(`Local API token: ${token}`);
  console.log(`Sessions: http://${host}:${port}/sessions`);
  if (mode === "subagent") {
    console.log(`Attacker queue: http://${host}:${port}/agent/jobs/next?role=attacker&worker=attacker-1&wait=30000`);
    console.log(`Builder queue: http://${host}:${port}/agent/jobs/next?role=builder&worker=builder-1&wait=30000`);
    console.log(`Tester queue: http://${host}:${port}/agent/jobs/next?role=tester&worker=tester-1&wait=30000`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
