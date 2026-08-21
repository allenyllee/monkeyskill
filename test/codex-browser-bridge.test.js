import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import {
  normalizeCodexBrowserBridgeUrl
} from "../src/lib/codex-browser-bridge.js";
import { createCodexBrowserBridge } from "../scripts/codex-browser-bridge-server.mjs";

const TOKEN = "a".repeat(64);

test("requires a tokenized loopback Browser Bridge URL", () => {
  assert.equal(normalizeCodexBrowserBridgeUrl(`ws://127.0.0.1:4501/${TOKEN}`), `ws://127.0.0.1:4501/${TOKEN}`);
  assert.throws(() => normalizeCodexBrowserBridgeUrl("ws://127.0.0.1:4500"), /完整一次性 URL/);
  assert.throws(() => normalizeCodexBrowserBridgeUrl(`ws://example.com/${TOKEN}`), /本機/);
});

test("accepts only the tokenized Extension upgrade and strips Origin upstream", async () => {
  let observedRequest = "";
  const upstream = net.createServer(socket => {
    socket.on("data", chunk => {
      observedRequest += chunk;
      if (!observedRequest.includes("\r\n\r\n")) return;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fake\r\n\r\n");
    });
  });
  await listen(upstream);
  const upstreamPort = upstream.address().port;
  const bridge = createCodexBrowserBridge({ token: TOKEN, upstreamPort });
  await listen(bridge);
  const bridgePort = bridge.address().port;
  try {
    const accepted = await rawUpgrade(bridgePort, `/${TOKEN}`, "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    assert.match(accepted, /^HTTP\/1\.1 101/);
    assert.match(observedRequest, /^GET \/ HTTP\/1\.1/);
    assert.doesNotMatch(observedRequest, /\r\nOrigin:/i);
    const rejected = await rawUpgrade(bridgePort, `/${"b".repeat(64)}`, "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    assert.match(rejected, /^HTTP\/1\.1 403/);
  } finally {
    await Promise.all([close(bridge), close(upstream)]);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function rawUpgrade(port, path, origin) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        `Origin: ${origin}`,
        "",
        ""
      ].join("\r\n"));
    });
    let response = "";
    socket.on("data", chunk => {
      response += chunk;
      if (!response.includes("\r\n\r\n")) return;
      socket.destroy();
      resolve(response);
    });
    socket.once("error", reject);
  });
}
