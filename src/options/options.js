const globalValue = document.querySelector("#global-value");
const overrides = document.querySelector("#overrides");
const resetButton = document.querySelector("#reset");
const installToggle = document.querySelector("#install-toggle");
const status = document.querySelector("#status");
let installed = false;

void render();

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

async function render() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }

  installed = Boolean(response.skill);
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

function label(mode) {
  return ({
    off: "停用",
    standard: "標準模式",
    absolute: "Absolute 模式"
  })[mode] ?? mode;
}
