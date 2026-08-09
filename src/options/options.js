const STORE_URL = "https://allenyllee.github.io/monkeyskill-store/";
const skillPicker = document.querySelector("#skill-picker");
const skillName = document.querySelector("#skill-name");
const skillState = document.querySelector("#skill-state");
const globalValue = document.querySelector("#global-value");
const sourceValue = document.querySelector("#source-value");
const versionValue = document.querySelector("#version-value");
const overrides = document.querySelector("#overrides");
const resetButton = document.querySelector("#reset");
const uninstallButton = document.querySelector("#uninstall");
const openStore = document.querySelector("#open-store");
const status = document.querySelector("#status");
const apiForm = document.querySelector("#api-form");
const apiEndpoint = document.querySelector("#api-endpoint");
const apiModel = document.querySelector("#api-model");
const apiKey = document.querySelector("#api-key");
const apiState = document.querySelector("#api-state");
const apiStatus = document.querySelector("#api-status");
const deleteApi = document.querySelector("#delete-api");
const storeForm = document.querySelector("#store-form");
const storeUrl = document.querySelector("#store-url");
const trustedStores = document.querySelector("#trusted-stores");
const storeStatus = document.querySelector("#store-status");

let skills = [];
let selected;

void Promise.all([renderSkills(), renderApiSettings(), renderTrustedStores()]);
skillPicker.addEventListener("change", () => void renderSkill(skillPicker.value));
openStore.addEventListener("click", () => chrome.tabs.create({ url: STORE_URL }));
resetButton.addEventListener("click", () => void resetSkill());
uninstallButton.addEventListener("click", () => void uninstallSkill());

apiForm.addEventListener("submit", async event => {
  event.preventDefault();
  apiStatus.textContent = "儲存中…";
  try {
    const origin = originPattern(apiEndpoint.value);
    if (!await chrome.permissions.request({ origins: [origin] })) throw new Error("未取得 LLM endpoint 權限。");
    const response = await chrome.runtime.sendMessage({
      type: "save-llm-settings",
      settings: { endpoint: apiEndpoint.value, model: apiModel.value, apiKey: apiKey.value }
    });
    if (!response.ok) throw new Error(response.error);
    apiKey.value = "";
    apiStatus.textContent = "API 設定已儲存。";
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

storeForm.addEventListener("submit", async event => {
  event.preventDefault();
  storeStatus.textContent = "儲存中…";
  try {
    const url = new URL(storeUrl.value);
    const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) throw new Error("Store URL 必須使用 HTTPS；本機開發除外。");
    if (!await chrome.permissions.request({ origins: [`${url.origin}/*`] })) throw new Error("未取得 Store origin 權限。");
    const response = await chrome.runtime.sendMessage({ type: "add-trusted-store", url: storeUrl.value });
    if (!response.ok) throw new Error(response.error);
    storeUrl.value = "";
    storeStatus.textContent = "Trusted Store 已加入；重新整理 Store 頁即可連線。";
    await renderTrustedStores();
  } catch (error) {
    storeStatus.textContent = error.message;
  }
});

async function renderSkills(preferredId) {
  const response = await chrome.runtime.sendMessage({ type: "list-installed-skills" });
  if (!response.ok) return status.textContent = response.error;
  skills = response.skills;
  skillPicker.replaceChildren();
  for (const skill of skills) skillPicker.add(new Option(skill.name, skill.id));
  skillState.textContent = `${skills.length} installed`;
  if (skills.length === 0) {
    skillPicker.add(new Option("請先從 Store 安裝", ""));
    skillPicker.disabled = true;
    selected = null;
    skillName.textContent = "尚未安裝";
    globalValue.textContent = "—";
    sourceValue.textContent = "—";
    versionValue.textContent = "—";
    resetButton.disabled = true;
    uninstallButton.disabled = true;
    renderEmptyOverrides("沒有已安裝的 MSkill。");
    return;
  }
  skillPicker.disabled = false;
  await renderSkill(skills.some(skill => skill.id === preferredId) ? preferredId : skills[0].id);
}

async function renderSkill(skillId) {
  const response = await chrome.runtime.sendMessage({ type: "get-state", skillId });
  if (!response.ok) return status.textContent = response.error;
  selected = response.skill;
  skillPicker.value = skillId;
  skillName.textContent = selected.skill.name;
  globalValue.textContent = selected.config.globalMode;
  sourceValue.textContent = selected.source.type;
  versionValue.textContent = selected.skill.version;
  resetButton.disabled = false;
  uninstallButton.disabled = false;
  overrides.replaceChildren();
  const entries = Object.entries(selected.config.siteOverrides);
  if (entries.length === 0) return renderEmptyOverrides("沒有網站例外設定。");
  for (const [pattern, mode] of entries) {
    const row = document.createElement("div");
    row.className = "override";
    const patternElement = document.createElement("span");
    patternElement.className = "pattern";
    patternElement.textContent = pattern;
    const modeElement = document.createElement("span");
    modeElement.className = "mode";
    modeElement.textContent = mode;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "移除";
    remove.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "remove-site-override", skillId, pattern });
      await renderSkill(skillId);
    });
    row.append(patternElement, modeElement, remove);
    overrides.append(row);
  }
}

async function resetSkill() {
  if (!selected) return;
  const response = await chrome.runtime.sendMessage({ type: "reset-skill", skillId: selected.skill.id });
  status.textContent = response.ok ? "設定已重設。" : response.error;
  await renderSkill(selected.skill.id);
}

async function uninstallSkill() {
  if (!selected) return;
  const id = selected.skill.id;
  const response = await chrome.runtime.sendMessage({ type: "uninstall-skill", skillId: id });
  status.textContent = response.ok ? "MSkill 已解除安裝。" : response.error;
  if (response.ok) await renderSkills();
}

function renderEmptyOverrides(text) {
  overrides.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  overrides.append(empty);
}

async function renderApiSettings() {
  const response = await chrome.runtime.sendMessage({ type: "get-llm-settings" });
  if (!response.ok) return apiStatus.textContent = response.error;
  apiEndpoint.value = response.settings.endpoint;
  apiModel.value = response.settings.model;
  apiKey.placeholder = response.settings.hasApiKey ? "已儲存；留白可保留原 key" : "輸入 API key";
  apiState.textContent = response.settings.hasApiKey ? "Configured" : "Not configured";
}

async function renderTrustedStores() {
  const response = await chrome.runtime.sendMessage({ type: "list-trusted-stores" });
  if (!response.ok) return storeStatus.textContent = response.error;
  trustedStores.replaceChildren();
  if (response.stores.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "尚未加入自訂 Store。";
    trustedStores.append(empty);
    return;
  }
  for (const url of response.stores) {
    const row = document.createElement("div");
    row.className = "override";
    const value = document.createElement("span");
    value.className = "pattern";
    value.textContent = url;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "移除信任";
    remove.addEventListener("click", async () => {
      const result = await chrome.runtime.sendMessage({ type: "remove-trusted-store", url });
      storeStatus.textContent = result.ok ? "Trusted Store 已移除。" : result.error;
      if (result.ok) await renderTrustedStores();
    });
    row.append(value, remove);
    trustedStores.append(row);
  }
}

function originPattern(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Endpoint 必須使用 HTTPS；本機開發除外。");
  }
  return `${url.protocol}//${url.host}/*`;
}
