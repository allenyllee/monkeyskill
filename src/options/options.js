const globalValue = document.querySelector("#global-value");
const overrides = document.querySelector("#overrides");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");

void render();

resetButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "reset-skill" });
  status.textContent = response.ok ? "已重設。" : response.error;
  await render();
});

async function render() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }

  globalValue.textContent = label(response.settings.globalMode);
  overrides.replaceChildren();
  const entries = Object.entries(response.settings.siteOverrides);

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

