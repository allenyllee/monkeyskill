import http from "node:http";
import net from "node:net";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function createCodexBrowserBridge(options) {
  const token = String(options.token || "").toLowerCase();
  if (!TOKEN_PATTERN.test(token)) throw new Error("Bridge token must contain 64 lowercase hex characters.");
  const upstreamHost = options.upstreamHost || "127.0.0.1";
  const upstreamPort = Number(options.upstreamPort || 4500);
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  });

  server.on("upgrade", (request, client, head) => {
    const origin = request.headers.origin;
    if (request.url !== `/${token}` || typeof origin !== "string" || !origin.startsWith("chrome-extension://")) {
      rejectSocket(client, 403, "Forbidden");
      return;
    }
    const upstream = net.connect(upstreamPort, upstreamHost);
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      upstream.write(buildUpstreamUpgradeRequest(request, upstreamHost, upstreamPort));
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once("error", () => {
      if (!connected) rejectSocket(client, 502, "Bad Gateway");
      else client.destroy();
    });
    client.once("error", () => upstream.destroy());
  });
  return server;
}

export function buildUpstreamUpgradeRequest(request, host = "127.0.0.1", port = 4500) {
  const lines = ["GET / HTTP/1.1", `Host: ${host}:${port}`];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const lower = name.toLowerCase();
    if (["host", "origin", "content-length", "proxy-connection"].includes(lower)) continue;
    lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function rejectSocket(socket, status, reason) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}
