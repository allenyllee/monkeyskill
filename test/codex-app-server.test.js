import test from "node:test";
import assert from "node:assert/strict";
import {
  CodexAppServerClient,
  normalizeCodexAppServerUrl,
  publicCodexAccount
} from "../src/lib/codex-app-server.js";

test("only accepts loopback Codex App Server websocket URLs", () => {
  assert.equal(normalizeCodexAppServerUrl("ws://127.0.0.1:4500"), "ws://127.0.0.1:4500");
  assert.equal(normalizeCodexAppServerUrl("ws://localhost:4500/"), "ws://localhost:4500");
  assert.throws(() => normalizeCodexAppServerUrl("wss://agent.example.com"), /本機/);
  assert.throws(() => normalizeCodexAppServerUrl("ws://192.168.1.2:4500"), /localhost/);
  assert.throws(() => normalizeCodexAppServerUrl("ws://user:pass@localhost:4500"), /不可包含/);
});

test("redacts Codex account data to fields needed by the UI", () => {
  assert.deepEqual(publicCodexAccount({
    account: { type: "chatgpt", email: "user@example.com", planType: "plus", accessToken: "secret" },
    requiresOpenaiAuth: true
  }), {
    connected: true,
    authenticated: true,
    accountType: "chatgpt",
    email: "user@example.com",
    planType: "plus",
    requiresOpenaiAuth: true
  });
});

test("performs initialize, account read, isolated smoke turn, and archive", async () => {
  const sockets = [];
  class FakeWebSocket extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(raw) {
      const message = JSON.parse(raw);
      this.sent.push(message);
      if (!Object.hasOwn(message, "id")) return;
      let result = {};
      if (message.method === "initialize") result = { userAgent: "fake" };
      if (message.method === "account/read") result = { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true };
      if (message.method === "thread/start") result = { thread: { id: "thread-1" } };
      if (message.method === "turn/start") result = { turn: { id: "turn-1", status: "inProgress" } };
      queueMicrotask(() => this.#message({ id: message.id, result }));
      if (message.method === "turn/start") queueMicrotask(() => {
        this.#message({ method: "item/completed", params: { threadId: "thread-1", item: { type: "agentMessage", phase: "final_answer", text: "MONKEYSKILL_AGENT_OK" } } });
        this.#message({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
      });
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    #message(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  }

  const client = await new CodexAppServerClient("ws://localhost:4500", { WebSocketImpl: FakeWebSocket }).connect();
  const smoke = await client.runSmokeTest();
  assert.equal(smoke.passed, true);
  assert.deepEqual(sockets[0].sent.map(message => message.method), [
    "initialize", "initialized", "account/read", "thread/start", "turn/start", "thread/archive"
  ]);
  assert.equal(sockets[0].sent.find(message => message.method === "turn/start").params.approvalPolicy, "never");
  assert.deepEqual(sockets[0].sent.find(message => message.method === "turn/start").params.sandboxPolicy, { type: "readOnly" });
  assert.equal(sockets[0].sent.find(message => message.method === "thread/start").params.sandbox, "read-only");
  client.close();
});
