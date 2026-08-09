const STORE_URL = "https://allenyllee.github.io/monkeyskill-store/";
const skillPicker = document.querySelector("#skill-picker");
const skillName = document.querySelector("#skill-name");
const source = document.querySelector("#source");
const siteMode = document.querySelector("#site-mode");
const globalMode = document.querySelector("#global-mode");
const siteName = document.querySelector("#site-name");
const saveButton = document.querySelector("#save");
const manageButton = document.querySelector("#manage");
const storeButton = document.querySelector("#store");
const status = document.querySelector("#status");

let activeTab;
let skills = [];
let selected;

void initialize();
skillPicker.addEventListener("change", () => void selectSkill(skillPicker.value));
saveButton.addEventListener("click", () => void save());
manageButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
storeButton.addEventListener("click", () => chrome.tabs.create({ url: STORE_URL }));

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  siteName.textContent = activeTab?.url && /^https?:\/\//.test(activeTab.url)
    ? new URL(activeTab.url).hostname
    : "不支援的頁面";
  const response = await chrome.runtime.sendMessage({ type: "list-installed-skills" });
  if (!response.ok) return setStatus(response.error, true);
  skills = response.skills;
  skillPicker.replaceChildren();
  for (const skill of skills) skillPicker.add(new Option(skill.name, skill.id));
  if (skills.length === 0) {
    skillPicker.add(new Option("請先從 Store 安裝", ""));
    skillPicker.disabled = true;
    siteMode.disabled = true;
    globalMode.disabled = true;
    saveButton.disabled = true;
    source.textContent = "Empty";
    setStatus("Extension 目前沒有內建或已安裝的 MSkill。請前往 Store。", false);
    return;
  }
  await selectSkill(skills[0].id);
}

async function selectSkill(skillId) {
  const metadata = skills.find(skill => skill.id === skillId);
  if (!metadata) return;
  const response = await chrome.runtime.sendMessage({
    type: "get-state",
    skillId,
    url: activeTab?.url && /^https?:\/\//.test(activeTab.url) ? activeTab.url : undefined
  });
  if (!response.ok) return setStatus(response.error, true);
  selected = response.skill;
  skillPicker.value = skillId;
  skillName.textContent = selected.skill.name;
  source.textContent = selected.source.type === "llm" ? "LLM" : selected.source.type;
  populateModes(siteMode, selected.skill.modes, true);
  populateModes(globalMode, selected.skill.modes, false);
  siteMode.value = response.siteMode ?? "inherit";
  globalMode.value = selected.config.globalMode;
  const supportedPage = Boolean(activeTab?.url && /^https?:\/\//.test(activeTab.url));
  siteMode.disabled = !supportedPage;
  saveButton.disabled = false;
  setStatus("");
}

function populateModes(select, modes, includeInherit) {
  select.replaceChildren();
  if (includeInherit) select.add(new Option("沿用全域設定", "inherit"));
  select.add(new Option("關閉", "off"));
  for (const mode of modes) select.add(new Option(mode, mode));
}

async function save() {
  if (!selected) return;
  try {
    saveButton.disabled = true;
    const requestedOrigins = [];
    if (globalMode.value !== "off") requestedOrigins.push("http://*/*", "https://*/*");
    else if (siteMode.value !== "off" && siteMode.value !== "inherit" && activeTab?.url) {
      const url = new URL(activeTab.url);
      requestedOrigins.push(`${url.protocol}//${url.hostname}/*`);
    }
    if (requestedOrigins.length > 0 && !await chrome.permissions.request({ origins: requestedOrigins })) {
      throw new Error("未取得網站權限。");
    }
    const globalResponse = await chrome.runtime.sendMessage({
      type: "set-global-mode",
      skillId: selected.skill.id,
      mode: globalMode.value
    });
    if (!globalResponse.ok) throw new Error(globalResponse.error);
    if (activeTab?.url && /^https?:\/\//.test(activeTab.url)) {
      const siteResponse = await chrome.runtime.sendMessage({
        type: "set-site-mode",
        skillId: selected.skill.id,
        mode: siteMode.value,
        url: activeTab.url
      });
      if (!siteResponse.ok) throw new Error(siteResponse.error);
      await chrome.tabs.reload(activeTab.id);
    }
    window.close();
  } catch (error) {
    setStatus(error.message, true);
    saveButton.disabled = false;
  }
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}
