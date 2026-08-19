import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("forwarder routes only real-browser conformance through the active generated Host", async t => {
  const worker = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ source: "worker" }));
  });
  const conformance = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ source: "generated-host" }));
  });
  worker.listen(0, "127.0.0.1");
  conformance.listen(0, "127.0.0.1");
  await Promise.all([once(worker, "listening"), once(conformance, "listening")]);
  t.after(() => worker.close());
  t.after(() => conformance.close());

  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const forwardPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));

  const temp = await mkdtemp(path.join(os.tmpdir(), "monkeyskill-forwarder-"));
  const manifestPath = path.join(temp, "active-host.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    bind: "127.0.0.1",
    port: conformance.address().port,
    route: "/v1/real-browser-conformance"
  }));
  t.after(() => rm(temp, { recursive: true, force: true }));

  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/forward-agent-api.mjs", import.meta.url))], {
    env: {
      ...process.env,
      MONKEYSKILL_FORWARD_PORT: String(forwardPort),
      MONKEYSKILL_WORKER_PORT: String(worker.address().port),
      MONKEYSKILL_CONFORMANCE_HOST_MANIFEST: manifestPath
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  t.after(async () => {
    child.kill();
    if (child.exitCode == null) await once(child, "exit");
  });
  child.stdout.setEncoding("utf8");
  await once(child.stdout, "data");

  const health = await fetch(`http://127.0.0.1:${forwardPort}/health`);
  assert.deepEqual(await health.json(), { source: "worker" });

  const result = await fetch(`http://127.0.0.1:${forwardPort}/v1/real-browser-conformance`, {
    method: "POST",
    headers: { authorization: "Bearer opaque", "content-type": "application/json" },
    body: "{}"
  });
  assert.deepEqual(await result.json(), { source: "generated-host" });
});
