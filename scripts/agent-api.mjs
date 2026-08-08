import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REQUEST_BYTES = 1_000_000;

export function createAgentApiServer(options = {}) {
  const sessions = new Map();
  const token = options.token || randomBytes(18).toString("base64url");
  const mode = options.mode || "fixture";
  const upstreamFetch = options.fetch || globalThis.fetch;
  const broker = createSubagentBroker(options.agentTimeoutMs || 300_000);

  const server = http.createServer(async (request, response) => {
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, mode });
        return;
      }
      if (!isAuthorized(request, token)) {
        sendJson(response, 401, { error: { message: "Invalid local agent token." } });
        return;
      }
      if (mode === "subagent" && request.method === "GET" && url.pathname === "/agent/jobs/next") {
        const job = await broker.take(Number(url.searchParams.get("wait")) || 0);
        if (!job) response.writeHead(204).end();
        else sendJson(response, 200, job);
        return;
      }
      const completionMatch = mode === "subagent" && request.method === "POST"
        ? url.pathname.match(/^\/agent\/jobs\/([^/]+)\/complete$/)
        : null;
      if (completionMatch) {
        const result = await readJsonBody(request);
        if (typeof result.content !== "string" || !result.content.trim()) {
          throw httpError(400, "Subagent completion must contain text content.");
        }
        if (!broker.complete(decodeURIComponent(completionMatch[1]), result.content)) {
          throw httpError(404, "Subagent job not found or already completed.");
        }
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/sessions") {
        sendJson(response, 200, { sessions: [...sessions.values()].map(publicSession) });
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/sessions/")) {
        const session = sessions.get(decodeURIComponent(url.pathname.slice(10)));
        if (!session) {
          sendJson(response, 404, { error: { message: "Agent session not found." } });
          return;
        }
        sendJson(response, 200, session);
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        sendJson(response, 404, { error: { message: "Route not found." } });
        return;
      }

      const body = await readJsonBody(request);
      validateChatRequest(body);
      const sessionId = request.headers["x-monkeyskill-session"] || randomUUID();
      const session = sessions.get(sessionId) || {
        id: sessionId,
        mode,
        createdAt: new Date().toISOString(),
        turns: []
      };
      session.turns.push({ role: "request", at: new Date().toISOString(), messages: body.messages });
      sessions.set(sessionId, session);

      let completion;
      if (mode === "proxy") completion = await runProxyAgent(body, { ...options, fetch: upstreamFetch });
      else if (mode === "subagent") {
        const content = await broker.submit({ sessionId, request: body });
        completion = chatCompletion(body.model, content);
      } else completion = await runFixtureAgent(body, options);
      session.turns.push({
        role: "assistant",
        at: new Date().toISOString(),
        content: completion.choices?.[0]?.message?.content ?? ""
      });
      response.setHeader("x-monkeyskill-agent-session", sessionId);
      sendJson(response, 200, completion);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: { message: error.message } });
    }
  });

  return { server, token, mode, sessions, broker };
}

function createSubagentBroker(timeoutMs) {
  const queued = [];
  const waitingWorkers = [];
  const active = new Map();

  function dispatch(job) {
    const worker = waitingWorkers.shift();
    if (worker) worker(job);
    else queued.push(job);
  }

  return {
    submit(payload) {
      const id = randomUUID();
      const job = { id, ...payload, createdAt: new Date().toISOString() };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          active.delete(id);
          reject(httpError(504, "Timed out waiting for the Codex subagent."));
        }, timeoutMs);
        active.set(id, { resolve, timer });
        dispatch(job);
      });
    },
    take(waitMs = 0) {
      if (queued.length) return Promise.resolve(queued.shift());
      if (waitMs <= 0) return Promise.resolve(null);
      return new Promise(resolve => {
        const worker = job => {
          clearTimeout(timer);
          resolve(job);
        };
        const timer = setTimeout(() => {
          const index = waitingWorkers.indexOf(worker);
          if (index >= 0) waitingWorkers.splice(index, 1);
          resolve(null);
        }, Math.min(waitMs, 30_000));
        waitingWorkers.push(worker);
      });
    },
    complete(id, content) {
      const pending = active.get(id);
      if (!pending) return false;
      clearTimeout(pending.timer);
      active.delete(id);
      pending.resolve(content);
      return true;
    }
  };
}

export async function runFixtureAgent(request, options = {}) {
  const skill = extractSkillManifest(request.messages);
  if (skill.id !== "restore-right-click") {
    throw httpError(422, `Fixture agent does not know MSkill: ${skill.id}`);
  }
  const artifact = await loadPackagedArtifact(options.projectRoot || projectRoot);
  const modes = {};
  for (const mode of skill.modes) {
    if (!artifact[mode]) throw httpError(422, `Fixture build is missing mode: ${mode}`);
    modes[mode] = artifact[mode];
  }
  return chatCompletion(request.model, JSON.stringify({
    schemaVersion: 1,
    summary: "Generated by the local fixture agent from the Restore right click MSkill.",
    modes
  }));
}

export async function runProxyAgent(request, options = {}) {
  const endpoint = options.upstreamEndpoint || process.env.MONKEYSKILL_UPSTREAM_ENDPOINT
    || "https://api.openai.com/v1/chat/completions";
  const apiKey = options.upstreamApiKey || process.env.MONKEYSKILL_UPSTREAM_API_KEY
    || process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(503, "Proxy mode requires MONKEYSKILL_UPSTREAM_API_KEY or OPENAI_API_KEY.");
  const payload = {
    ...request,
    model: options.upstreamModel || process.env.MONKEYSKILL_UPSTREAM_MODEL || request.model
  };
  const upstream = await options.fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await upstream.text();
  if (!upstream.ok) throw httpError(502, `Upstream agent failed (${upstream.status}): ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, "Upstream agent returned invalid JSON.");
  }
}

async function loadPackagedArtifact(root) {
  const descriptor = JSON.parse(await readFile(join(root, "packages", "restore-right-click.mskill.json"), "utf8"));
  const build = JSON.parse(await readFile(join(root, descriptor.build), "utf8"));
  const artifact = {};
  for (const [mode, paths] of Object.entries(build.modes)) {
    artifact[mode] = {
      js: (await Promise.all(paths.js.map(path => readFile(join(root, path), "utf8")))).join("\n"),
      css: (await Promise.all(paths.css.map(path => readFile(join(root, path), "utf8")))).join("\n")
    };
  }
  return artifact;
}

function extractSkillManifest(messages) {
  const text = messages.filter(message => message.role === "user")
    .map(message => typeof message.content === "string" ? message.content : "")
    .join("\n");
  const match = text.match(/Skill manifest:\s*([\s\S]*?)\n\nSKILL\.md:/);
  if (!match) throw httpError(422, "Agent request does not contain a Skill manifest.");
  try {
    return JSON.parse(match[1]);
  } catch {
    throw httpError(422, "Skill manifest is not valid JSON.");
  }
}

function chatCompletion(model, content) {
  return {
    id: `chatcmpl-local-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model || "local-agent",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

function validateChatRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw httpError(400, "messages must be a non-empty array.");
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(httpError(413, "Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(httpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function isAuthorized(request, token) {
  return request.headers.authorization === `Bearer ${token}`;
}

function publicSession(session) {
  return { id: session.id, mode: session.mode, createdAt: session.createdAt, turns: session.turns.length };
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type, x-monkeyskill-session");
  response.setHeader("access-control-expose-headers", "x-monkeyskill-agent-session");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
