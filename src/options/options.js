const globalValue = document.querySelector("#global-value");
const overrides = document.querySelector("#overrides");
const resetButton = document.querySelector("#reset");
const installToggle = document.querySelector("#install-toggle");
const status = document.querySelector("#status");
const skillState = document.querySelector("#skill-state");
const apiForm = document.querySelector("#api-form");
const apiEndpoint = document.querySelector("#api-endpoint");
const apiModel = document.querySelector("#api-model");
const apiKey = document.querySelector("#api-key");
const apiState = document.querySelector("#api-state");
const apiStatus = document.querySelector("#api-status");
const deleteApi = document.querySelector("#delete-api");
const generateSkill = document.querySelector("#generate-skill");
const generationStatus = document.querySelector("#generation-status");
const draft = document.querySelector("#draft");
const draftSummary = document.querySelector("#draft-summary");
const draftModel = document.querySelector("#draft-model");
const draftValidation = document.querySelector("#draft-validation");
const draftHash = document.querySelector("#draft-hash");
const draftCode = document.querySelector("#draft-code");
const approveBuild = document.querySelector("#approve-build");
const discardBuild = document.querySelector("#discard-build");
let installed = false;

void Promise.all([render(), renderApiSettings(), renderPendingBuild()]);

resetButton.addEventListener("click", async () => {
  if (!installed) return;
  const response = await chrome.runtime.sendMessage({ type: "reset-skill" });
  status.textContent = response.ok ? "已重設。" : response.error;
  await render();
});

installToggle.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: installed ? "uninstall-skill" : "install-bundled-skill",
    skillId: "restore-right-click"
  });
  status.textContent = response.ok
    ? installed ? "已解除安裝。" : "已重新安裝。"
    : response.error;
  await render();
});

apiForm.addEventListener("submit", async event => {
  event.preventDefault();
  apiStatus.textContent = "正在保存…";
  try {
    const origin = originPattern(apiEndpoint.value);
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error("未取得連線至 LLM endpoint 的權限。");
    const response = await chrome.runtime.sendMessage({
      type: "save-llm-settings",
      settings: {
        endpoint: apiEndpoint.value,
        model: apiModel.value,
        apiKey: apiKey.value
      }
    });
    if (!response.ok) throw new Error(response.error);
    apiKey.value = "";
    apiStatus.textContent = "API 設定已保存在本機。";
    await renderApiSettings();
  } catch (error) {
    apiStatus.textContent = error.message;
  }
});

deleteApi.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "delete-llm-settings" });
  apiStatus.textContent = response.ok ? "API 設定已刪除。" : response.error;
  await renderApiSettings();
});

generateSkill.addEventListener("click", async () => {
  generateSkill.disabled = true;
  generationStatus.textContent = "正在請求 LLM 生成並檢查…";
  try {
    const llmState = await chrome.runtime.sendMessage({ type: "get-llm-settings" });
    if (!llmState.ok || !llmState.settings.hasApiKey) throw new Error("請先保存自己的 LLM API 設定。");
    if (!chrome.userScripts) throw new Error("請先在擴充套件詳細頁開啟 Allow User Scripts。");
    try {
      await chrome.userScripts.getScripts();
    } catch {
      throw new Error("請先在擴充套件詳細頁開啟 Allow User Scripts。");
    }
    const granted = await chrome.permissions.request({
      origins: ["https://monkeyskill-validation.invalid/*"]
    });
    if (!granted) throw new Error("未取得暫存語法驗證所需權限。");
    const response = await chrome.runtime.sendMessage({
      type: "generate-bundled-skill",
      skillId: "restore-right-click"
    });
    if (!response.ok) throw new Error(response.error);
    generationStatus.textContent = "生成與驗證完成，請檢查草稿後核准。";
    showDraft(response.draft);
  } catch (error) {
    generationStatus.textContent = error.message;
  } finally {
    generateSkill.disabled = false;
  }
});

approveBuild.addEventListener("click", async () => {
  approveBuild.disabled = true;
  generationStatus.textContent = "正在核准並安裝…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "approve-generated-skill",
      skillId: "restore-right-click"
    });
    if (!response.ok) throw new Error(response.error);
    generationStatus.textContent = "LLM build 已核准並安裝；請選擇網站與模式後啟用。";
    draft.hidden = true;
    await render();
  } catch (error) {
    generationStatus.textContent = error.message;
  } finally {
    approveBuild.disabled = false;
  }
});

discardBuild.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "discard-generated-skill",
    skillId: "restore-right-click"
  });
  generationStatus.textContent = response.ok ? "草稿已捨棄。" : response.error;
  if (response.ok) draft.hidden = true;
});

async function render() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }

  installed = Boolean(response.skill);
  skillState.textContent = installed
    ? response.skill.source.type === "llm" ? "Installed · LLM" : "Installed · Bundled"
    : "Not installed";
  installToggle.textContent = installed ? "解除安裝" : "重新安裝";
  installToggle.classList.toggle("danger", installed);
  resetButton.disabled = !installed;
  globalValue.textContent = installed ? label(response.skill.config.globalMode) : "未安裝";
  overrides.replaceChildren();
  const entries = Object.entries(response.skill?.config.siteOverrides ?? {});

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "目前沒有網站覆寫設定。";
    overrides.append(empty);
    return;
  }

  for (const [pattern, mode] of entries) {
    const row = document.createElement("div");
    row.className = "override";

    const patternElement = document.createElement("span");
    patternElement.className = "pattern";
    patternElement.textContent = pattern;

    const modeElement = document.createElement("span");
    modeElement.className = "mode";
    modeElement.textContent = label(mode);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "移除覆寫";
    remove.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "remove-site-override",
        pattern
      });
      await render();
    });

    row.append(patternElement, modeElement, remove);
    overrides.append(row);
  }
}

async function renderApiSettings() {
  const response = await chrome.runtime.sendMessage({ type: "get-llm-settings" });
  if (!response.ok) {
    apiStatus.textContent = response.error;
    return;
  }
  apiEndpoint.value = response.settings.endpoint;
  apiModel.value = response.settings.model;
  apiKey.placeholder = response.settings.hasApiKey ? "已保存；留空表示不變" : "尚未保存";
  apiState.textContent = response.settings.hasApiKey ? "Configured" : "Not configured";
}

async function renderPendingBuild() {
  const response = await chrome.runtime.sendMessage({
    type: "get-pending-build",
    skillId: "restore-right-click"
  });
  if (!response.ok) {
    generationStatus.textContent = response.error;
    return;
  }
  if (response.draft) showDraft(response.draft);
}

function showDraft(value) {
  draft.hidden = false;
  draftSummary.textContent = value.summary;
  draftModel.textContent = value.generation.model;
  draftValidation.textContent = value.validation.join("、");
  draftHash.textContent = value.generation.hash.slice(0, 16);
  draftCode.textContent = Object.entries(value.modes).map(([mode, artifact]) => [
    `// MODE: ${mode} — JS ${artifact.jsBytes} bytes / CSS ${artifact.cssBytes} bytes`,
    artifact.js,
    artifact.css ? `\n/* CSS */\n${artifact.css}` : ""
  ].join("\n")).join("\n\n");
}

function originPattern(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Endpoint 必須使用 HTTPS；本機開發除外。");
  }
  return `${url.protocol}//${url.host}/*`;
}

function label(mode) {
  return ({
    off: "停用",
    standard: "標準模式",
    absolute: "Absolute 模式"
  })[mode] ?? mode;
}
