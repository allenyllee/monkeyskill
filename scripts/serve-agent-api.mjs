import { createAgentApiServer } from "./agent-api.mjs";

const host = "127.0.0.1";
const port = Number(process.env.MONKEYSKILL_AGENT_PORT || 8787);
const mode = process.env.MONKEYSKILL_AGENT_MODE || "fixture";
const { server, token } = createAgentApiServer({
  mode,
  token: process.env.MONKEYSKILL_LOCAL_TOKEN,
  agentTimeoutMs: Number(process.env.MONKEYSKILL_AGENT_TIMEOUT_MS || 900_000)
});

server.listen(port, host, () => {
  console.log(`MonkeySkill agent API: http://${host}:${port}/v1/chat/completions`);
  console.log(`Mode: ${mode}`);
  console.log(`Local API token: ${token}`);
  console.log(`Sessions: http://${host}:${port}/sessions`);
  if (mode === "subagent") {
    console.log(`Builder queue: http://${host}:${port}/agent/jobs/next?role=builder&worker=builder-1&wait=30000`);
    console.log(`Tester queue: http://${host}:${port}/agent/jobs/next?role=tester&worker=tester-1&wait=30000`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
