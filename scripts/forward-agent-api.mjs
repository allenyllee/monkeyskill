import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const listenPort = Number(process.env.MONKEYSKILL_FORWARD_PORT || 8787);
const targetPort = Number(process.env.MONKEYSKILL_WORKER_PORT || 8788);
const host = "127.0.0.1";
const conformance = loadConformanceTarget();

const server = http.createServer((request, response) => {
  const target = conformance && new URL(request.url, `http://${host}`).pathname === conformance.route
    ? conformance
    : { host, port: targetPort };
  const conformanceRequest = target === conformance;
  const startedAt = conformanceRequest ? Date.now() : 0;
  const upstream = http.request({
    host: target.host,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `${target.host}:${target.port}` }
  }, upstreamResponse => {
    if (conformanceRequest) {
      response.once("finish", () => {
        console.log(`MonkeySkill conformance: status=${upstreamResponse.statusCode || 502} durationMs=${Date.now() - startedAt}`);
      });
    }
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", error => {
    if (conformanceRequest) {
      console.error(`MonkeySkill conformance transport: code=${error.code || "unknown"} durationMs=${Date.now() - startedAt}`);
    }
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: `Worker API unavailable: ${error.code || "unknown"}` }));
  });
  request.pipe(upstream);
});

server.listen(listenPort, host, () => {
  const suffix = conformance
    ? `; ${conformance.route} -> http://${conformance.host}:${conformance.port}`
    : "";
  console.log(`MonkeySkill local forwarder: http://${host}:${listenPort} -> http://${host}:${targetPort}${suffix}`);
});

function loadConformanceTarget() {
  if (process.env.MONKEYSKILL_CONFORMANCE_DISABLED === "1") return null;
  const manifestPath = process.env.MONKEYSKILL_CONFORMANCE_HOST_MANIFEST
    || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "MonkeySkill", "runner", "active-host.json") : "");
  if (!manifestPath || !existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest?.schemaVersion !== 1
      || manifest?.bind !== host
      || !Number.isInteger(manifest?.port)
      || manifest.port < 1
      || manifest.port > 65535
      || typeof manifest?.route !== "string"
      || !manifest.route.startsWith("/")
      || manifest.route.includes("?")
      || manifest.route.includes("#")) return null;
    return { host: manifest.bind, port: manifest.port, route: manifest.route };
  } catch {
    return null;
  }
}
