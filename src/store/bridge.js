(() => {
  const pageOrigin = location.origin;
  const localPage = location.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(location.hostname);
  if (location.protocol !== "https:" && !localPage) return;

  const actions = new Map([
    ["list", "store-list-installed-skills"],
    ["generate", "store-generate-store-skill"],
    ["approve", "store-approve-generated-skill"],
    ["discard", "store-discard-generated-skill"],
    ["pending", "store-get-pending-build"],
    ["status", "store-get-generation-status"],
    ["clear-history", "store-clear-generation-history"]
  ]);

  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== pageOrigin || request?.source !== "monkeyskill-store") return;
    const type = actions.get(request.action);
    if (!type || typeof request.requestId !== "string") return;
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type,
        skillId: request.skillId,
        skillPackage: request.action === "generate" ? request.skillPackage : undefined
      });
    } catch (error) {
      response = { ok: false, error: error.message };
    }
    window.postMessage({
      source: "monkeyskill-extension",
      requestId: request.requestId,
      response
    }, pageOrigin);
  });

  window.postMessage({ source: "monkeyskill-extension", type: "ready" }, pageOrigin);
})();
