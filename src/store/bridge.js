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
    ["clear-history", "store-clear-generation-history"],
    ["verify-bootstrap", "store-verify-runner-bootstrap"]
  ]);
  if (localPage) {
    actions.set("reload-extension", "store-reload-extension");
    actions.set("set-test-mode", "store-set-test-mode");
  }

  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== pageOrigin || request?.source !== "monkeyskill-store") return;
    if (request.action === "ping" && typeof request.requestId === "string") {
      window.postMessage({
        source: "monkeyskill-extension",
        requestId: request.requestId,
        response: { ok: true }
      }, pageOrigin);
      return;
    }
    const type = actions.get(request.action);
    if (!type || typeof request.requestId !== "string") return;
    let response;
    try {
      const bootstrap = request.action === "verify-bootstrap"
        ? await observeRunnerBootstrap(request.bootstrap)
        : undefined;
      response = await chrome.runtime.sendMessage({
        type,
        skillId: request.skillId,
        mode: request.action === "set-test-mode" ? request.mode : undefined,
        skillPackage: request.action === "generate" ? request.skillPackage : undefined,
        bootstrap
      });
      if (request.action === "verify-bootstrap" && response?.ok) {
        const { clipboardText, ...publicResponse } = response;
        copyVerifiedText(clipboardText);
        response = publicResponse;
      }
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

  async function observeRunnerBootstrap(descriptor) {
    assertExactKeys(descriptor, ["id", "version", "bootstrapUrl", "packageHash"], "Runner Bootstrap descriptor");
    if (typeof descriptor.id !== "string" || typeof descriptor.version !== "string"
      || !/^[a-f0-9]{64}$/.test(descriptor.packageHash)) {
      throw new Error("Runner Bootstrap descriptor is invalid.");
    }
    const bootstrapUrl = new URL(descriptor.bootstrapUrl, location.href);
    if (bootstrapUrl.origin !== pageOrigin || bootstrapUrl.search || bootstrapUrl.hash
      || !bootstrapUrl.pathname.endsWith("/bootstrap.json")) {
      throw new Error("Runner Bootstrap must use a same-origin immutable URL.");
    }
    const response = await fetch(bootstrapUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    });
    if (!response.ok || response.url !== bootstrapUrl.href) throw new Error("Unable to fetch the exact Runner Bootstrap manifest.");
    const pkg = JSON.parse(await response.text());
    assertExactKeys(pkg, ["schemaVersion", "artifactType", "id", "version", "entrypoint", "workflow", "files", "packageHash"], "Runner Bootstrap manifest");
    if (pkg.schemaVersion !== 1 || pkg.artifactType !== "runner-bootstrap"
      || pkg.id !== descriptor.id || pkg.version !== descriptor.version
      || pkg.packageHash !== descriptor.packageHash || !Array.isArray(pkg.files)) {
      throw new Error("Runner Bootstrap manifest does not match the Store descriptor.");
    }
    if (pkg.files.length < 1 || pkg.files.length > 32) throw new Error("Runner Bootstrap file count is invalid.");
    const versionRoot = new URL("./", bootstrapUrl);
    const seen = new Set();
    let verifiedByteCount = 0;
    let protocolProfile;
    for (const file of pkg.files) {
      assertExactKeys(file, ["path", "sha256", "bytes"], "Runner Bootstrap file entry");
      if (typeof file.path !== "string" || !isSafeRelativePath(file.path) || seen.has(file.path)
        || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes)
        || file.bytes < 1 || file.bytes > 200_000) {
        throw new Error("Runner Bootstrap file entry is invalid.");
      }
      seen.add(file.path);
      const fileUrl = new URL(file.path, versionRoot);
      if (fileUrl.origin !== pageOrigin || !fileUrl.href.startsWith(versionRoot.href)) {
        throw new Error("Runner Bootstrap file escaped its immutable package root.");
      }
      const fileResponse = await fetch(fileUrl, { cache: "no-store", credentials: "omit", redirect: "error" });
      if (!fileResponse.ok || fileResponse.url !== fileUrl.href) throw new Error(`Unable to fetch Runner Bootstrap file: ${file.path}`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      if (bytes.byteLength !== file.bytes || await sha256Hex(bytes) !== file.sha256) {
        throw new Error(`Runner Bootstrap file hash mismatch: ${file.path}`);
      }
      verifiedByteCount += bytes.byteLength;
      if (verifiedByteCount > 1_000_000) throw new Error("Runner Bootstrap package is too large.");
      if (file.path === "protocol/host-dsl-profile.json") {
        protocolProfile = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      }
    }
    if (!seen.has(pkg.entrypoint) || !seen.has(pkg.workflow) || !protocolProfile) {
      throw new Error("Runner Bootstrap package is incomplete.");
    }
    const packageCore = {
      schemaVersion: pkg.schemaVersion,
      artifactType: pkg.artifactType,
      id: pkg.id,
      version: pkg.version,
      entrypoint: pkg.entrypoint,
      workflow: pkg.workflow,
      files: pkg.files.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes }))
    };
    if (await sha256Hex(new TextEncoder().encode(JSON.stringify(packageCore))) !== pkg.packageHash) {
      throw new Error("Runner Bootstrap package hash is invalid.");
    }
    return {
      id: pkg.id,
      version: pkg.version,
      bootstrapUrl: bootstrapUrl.href,
      packageHash: pkg.packageHash,
      protocolSchemaVersion: protocolProfile.schemaVersion,
      protocolProfile: protocolProfile.profile,
      verifiedFileCount: pkg.files.length,
      verifiedByteCount
    };
  }

  function assertExactKeys(value, expected, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw new Error(`${label} has unsupported fields.`);
    }
  }

  function isSafeRelativePath(value) {
    return value.length <= 160 && !value.startsWith("/") && !value.includes("\\")
      && value.split("/").every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
        && segment !== "." && segment !== "..");
  }

  async function sha256Hex(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function copyVerifiedText(text) {
    if (typeof text !== "string" || text.length < 100 || text.length > 4_000) {
      throw new Error("Extension returned an invalid verified prompt.");
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.cssText = "position:fixed;inset:-9999px;width:1px;height:1px;opacity:0";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Extension clipboard write failed.");
  }
})();
