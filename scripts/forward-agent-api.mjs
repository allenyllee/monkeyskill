import http from "node:http";

const listenPort = Number(process.env.MONKEYSKILL_FORWARD_PORT || 8787);
const targetPort = Number(process.env.MONKEYSKILL_WORKER_PORT || 8788);
const host = "127.0.0.1";

const server = http.createServer((request, response) => {
  const upstream = http.request({
    host,
    port: targetPort,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `${host}:${targetPort}` }
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", error => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: `Worker API unavailable: ${error.code || "unknown"}` }));
  });
  request.pipe(upstream);
});

server.listen(listenPort, host, () => {
  console.log(`MonkeySkill local forwarder: http://${host}:${listenPort} -> http://${host}:${targetPort}`);
});
