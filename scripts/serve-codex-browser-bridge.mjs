import { randomBytes } from "node:crypto";
import { createCodexBrowserBridge } from "./codex-browser-bridge-server.mjs";

const argv = process.argv.slice(2);
const option = name => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const host = "127.0.0.1";
const port = Number(option("--port") || process.env.MONKEYSKILL_CODEX_BRIDGE_PORT || 4501);
const upstreamPort = Number(option("--upstream-port") || process.env.MONKEYSKILL_CODEX_APP_SERVER_PORT || 4500);
const token = (option("--token") || process.env.MONKEYSKILL_CODEX_BRIDGE_TOKEN || randomBytes(32).toString("hex")).toLowerCase();

await requireUpstream(upstreamPort);
const server = createCodexBrowserBridge({ token, upstreamHost: host, upstreamPort });
server.listen(port, host, () => {
  console.log(`MonkeySkill Codex Browser Bridge: ws://${host}:${port}/${token}`);
  console.log(`Upstream Codex App Server: ws://${host}:${upstreamPort}`);
  console.log("Paste the complete Browser Bridge URL into the MonkeySkill Extension options.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function requireUpstream(targetPort) {
  try {
    const response = await fetch(`http://${host}:${targetPort}/readyz`, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) return;
  } catch {}
  console.error(`Codex App Server is not ready on 127.0.0.1:${targetPort}.`);
  console.error(`Start it first: npx.cmd --yes @openai/codex@0.149.0 app-server --listen ws://${host}:${targetPort}`);
  process.exit(1);
}
