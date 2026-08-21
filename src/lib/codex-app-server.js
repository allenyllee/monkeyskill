export const DEFAULT_CODEX_APP_SERVER_URL = "ws://127.0.0.1:4500";

export function normalizeCodexAppServerUrl(value = DEFAULT_CODEX_APP_SERVER_URL) {
  const url = new URL(String(value).trim());
  if (url.protocol !== "ws:") throw new Error("Codex App Server 必須使用本機 ws:// 連線。");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Codex App Server 只允許連到 localhost。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Codex App Server URL 不可包含帳密、query 或 fragment。");
  }
  url.pathname = url.pathname === "/" ? "/" : url.pathname;
  return url.toString().replace(/\/$/, "");
}

export function codexAppServerOriginPattern(value = DEFAULT_CODEX_APP_SERVER_URL) {
  const url = new URL(normalizeCodexAppServerUrl(value));
  return `http://${url.host}/*`;
}

export function publicCodexAccount(result) {
  const account = result?.account;
  return {
    connected: true,
    authenticated: Boolean(account) || result?.requiresOpenaiAuth === false,
    accountType: typeof account?.type === "string" ? account.type : null,
    email: typeof account?.email === "string" ? account.email : null,
    planType: typeof account?.planType === "string" ? account.planType : null,
    requiresOpenaiAuth: result?.requiresOpenaiAuth !== false
  };
}

export class CodexAppServerClient {
  constructor(url, options = {}) {
    this.url = normalizeCodexAppServerUrl(url);
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.notificationListeners = new Set();
  }

  async connect() {
    if (typeof this.WebSocketImpl !== "function") throw new Error("此瀏覽器不支援 WebSocket。");
    this.socket = new this.WebSocketImpl(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex App Server 連線逾時。")), this.timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("無法連線到 Codex App Server；請確認本機服務已啟動。"));
      }, { once: true });
    });
    this.socket.addEventListener("message", event => void this.#receive(event.data));
    this.socket.addEventListener("close", () => this.#failPending(new Error("Codex App Server 連線已關閉。")));
    await this.request("initialize", {
      clientInfo: {
        name: "monkeyskill_extension",
        title: "MonkeySkill Extension",
        version: "0.3.7"
      }
    });
    this.notify("initialized");
    return this;
  }

  request(method, params) {
    if (!this.socket || this.socket.readyState !== 1) return Promise.reject(new Error("Codex App Server 尚未連線。"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 逾時。`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ method, id, ...(params === undefined ? {} : { params }) }));
    });
  }

  notify(method, params) {
    if (!this.socket || this.socket.readyState !== 1) throw new Error("Codex App Server 尚未連線。");
    this.socket.send(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }));
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  waitForNotification(method, predicate = () => true, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.onNotification(message => {
        if (message.method !== method || !predicate(message.params)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(message.params);
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`${method} 逾時。`));
      }, timeoutMs);
    });
  }

  async readAccount() {
    return publicCodexAccount(await this.request("account/read", { refreshToken: false }));
  }

  async startChatGptLogin() {
    return this.request("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt"
    });
  }

  async runSmokeTest() {
    const account = await this.readAccount();
    if (!account.authenticated) throw new Error("請先登入 ChatGPT。");
    const started = await this.request("thread/start", {
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "monkeyskill_extension_smoke_test"
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("Codex App Server 未回傳 thread id。");
    const finalMessages = [];
    const unsubscribe = this.onNotification(message => {
      const item = message.params?.item;
      if (message.method === "item/completed" && item?.type === "agentMessage" && item.phase !== "commentary") {
        finalMessages.push(item.text);
      }
    });
    try {
      const completed = this.waitForNotification("turn/completed", params => params?.threadId === threadId, 90_000);
      const turn = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "This is a connection smoke test. Do not use tools. Reply with exactly: MONKEYSKILL_AGENT_OK" }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" }
      });
      const result = await completed;
      if (result?.turn?.id && turn?.turn?.id && result.turn.id !== turn.turn.id) {
        throw new Error("收到其他 Agent turn 的完成事件。");
      }
      if (result?.turn?.status !== "completed") {
        throw new Error(result?.turn?.error?.message || `Agent turn 狀態為 ${result?.turn?.status || "unknown"}。`);
      }
      const reply = finalMessages.at(-1)?.trim() || "";
      return {
        threadId,
        turnId: result.turn.id,
        reply,
        passed: reply === "MONKEYSKILL_AGENT_OK"
      };
    } finally {
      unsubscribe();
      try { await this.request("thread/archive", { threadId }); } catch {}
    }
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  async #receive(raw) {
    const text = typeof raw === "string" ? raw : typeof raw?.text === "function" ? await raw.text() : String(raw);
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex App Server request failed."));
      else pending.resolve(message.result);
      return;
    }
    if (Object.hasOwn(message, "id") && message.method) {
      this.socket?.send(JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` }
      }));
      return;
    }
    if (message.method) for (const listener of this.notificationListeners) listener(message);
  }

  #failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
