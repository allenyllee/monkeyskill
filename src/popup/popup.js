const siteMode = document.querySelector("#site-mode");
const globalMode = document.querySelector("#global-mode");
const siteName = document.querySelector("#site-name");
const saveButton = document.querySelector("#save");
const manageButton = document.querySelector("#manage");
const status = document.querySelector("#status");

let activeTab;
let installed = false;

void initialize();

saveButton.addEventListener("click", () => void save());
manageButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url || !/^https?:\/\//.test(activeTab.url)) {
    setUnavailable("此頁面受 Chrome 保護，無法安裝 Monkey Skill。");
    return;
  }

  const url = new URL(activeTab.url);
  siteName.textContent = url.hostname;
  const response = await chrome.runtime.sendMessage({
    type: "get-state",
    url: activeTab.url
  });
  if (!response.ok) throw new Error(response.error);

  installed = Boolean(response.skill);
  siteMode.disabled = !installed;
  globalMode.disabled = !installed;
  saveButton.textContent = installed ? "套用並重新整理" : "安裝這個 Skill";

  if (installed) {
    siteMode.value = response.siteMode;
    globalMode.value = response.skill.config.globalMode;
    setStatus("");
  } else {
    siteMode.value = "inherit";
    globalMode.value = "off";
    setStatus("這個 bundled Skill 目前未安裝。");
  }
}

async function save() {
  try {
    saveButton.disabled = true;
    if (!installed) {
      setStatus("正在安裝 Skill package…");
      const response = await chrome.runtime.sendMessage({
        type: "install-bundled-skill",
        skillId: "restore-right-click"
      });
      if (!response.ok) throw new Error(response.error);
      await initialize();
      saveButton.disabled = false;
      setStatus("已安裝。選擇執行範圍後即可套用。");
      return;
    }

    setStatus("正在套用…");

    const requestedOrigins = [];
    if (globalMode.value !== "off") {
      requestedOrigins.push("http://*/*", "https://*/*");
    } else if (siteMode.value === "standard" || siteMode.value === "absolute") {
      const url = new URL(activeTab.url);
      requestedOrigins.push(`${url.protocol}//${url.hostname}/*`);
    }

    if (requestedOrigins.length > 0) {
      const granted = await chrome.permissions.request({ origins: requestedOrigins });
      if (!granted) throw new Error("未取得所選網站範圍的執行權限。");
    }

    const globalResponse = await chrome.runtime.sendMessage({
      type: "set-global-mode",
      mode: globalMode.value
    });
    if (!globalResponse.ok) throw new Error(globalResponse.error);

    const siteResponse = await chrome.runtime.sendMessage({
      type: "set-site-mode",
      mode: siteMode.value,
      url: activeTab.url
    });
    if (!siteResponse.ok) throw new Error(siteResponse.error);

    setStatus("已套用，正在重新整理頁面。");
    await chrome.tabs.reload(activeTab.id);
    window.close();
  } catch (error) {
    setStatus(error.message, true);
    saveButton.disabled = false;
  }
}

function setUnavailable(message) {
  siteName.textContent = "不支援";
  siteMode.disabled = true;
  saveButton.disabled = true;
  setStatus(message, true);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}
