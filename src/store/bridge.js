(() => {
  const pageOrigin = location.origin;
  const approvedPage = ["http://127.0.0.1:4173", "http://localhost:4173"].includes(pageOrigin)
    && location.pathname === "/store.html";
  if (!approvedPage) return;

  const actions = new Map([
    ["list", "store-list-skills"],
    ["generate", "store-generate-bundled-skill"],
    ["approve", "store-approve-generated-skill"],
    ["discard", "store-discard-generated-skill"],
    ["pending", "store-get-pending-build"],
    ["status", "store-get-generation-status"]
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
        skillId: request.skillId
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
