const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeCodexBrowserBridgeUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Browser Bridge 必須使用本機 ws:// URL。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Browser Bridge URL 不可包含帳密、query 或 fragment。");
  }
  const token = url.pathname.replace(/^\//, "");
  if (!TOKEN_PATTERN.test(token)) throw new Error("請貼上 Browser Bridge 顯示的完整一次性 URL。");
  return url.toString().replace(/\/$/, "");
}
