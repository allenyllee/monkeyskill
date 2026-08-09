const catalog = document.querySelector("#catalog");
const template = document.querySelector("#skill-template");
const connection = document.querySelector("#connection");
const count = document.querySelector("#count");
const notice = document.querySelector("#notice");
const dialog = document.querySelector("#decision-dialog");
const dialogEyebrow = document.querySelector("#dialog-eyebrow");
const dialogTitle = document.querySelector("#dialog-title");
const dialogCopy = document.querySelector("#dialog-copy");
const dialogDetails = document.querySelector("#dialog-details");
const dialogConfirm = document.querySelector("#dialog-confirm");
const pendingRequests = new Map();
let skills = [];

window.addEventListener("message", event => {
  const message = event.data;
  if (event.source !== window || event.origin !== location.origin || message?.source !== "monkeyskill-extension") return;
  if (message.type === "ready") {
    connection.textContent = "Extension connected";
    connection.classList.add("ready");
    return;
  }
  const request = pendingRequests.get(message.requestId);
  if (!request) return;
  clearTimeout(request.timeout);
  pendingRequests.delete(message.requestId);
  request.resolve(message.response);
});

void initialize();

async function initialize() {
  try {
    const response = await rpc("list", null, 5000);
    if (!response.ok) throw new Error(response.error);
    connection.textContent = "Extension connected";
    connection.classList.add("ready");
    skills = response.skills;
    renderCatalog();
    await restoreWorkflow();
  } catch (error) {
    connection.textContent = "Extension not detected";
    showNotice(`${error.message}\n請確認 MonkeySkill 已重新載入，並使用 npm run serve:demo 開啟此頁。`, true);
  }
}

function renderCatalog() {
  catalog.replaceChildren();
  count.textContent = `${skills.length} MSKILL${skills.length === 1 ? "" : "S"}`;
  for (const skill of skills) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.skillId = skill.id;
    card.querySelector("h3").textContent = skill.name;
    card.querySelector(".version").textContent = `v${skill.version}`;
    card.querySelector(".description").textContent = skill.description;
    card.querySelector(".badge").textContent = skill.installed ? `Installed · ${skill.source}` : "Available";
    card.querySelector(".skill-status").textContent = skill.installed ? "已安裝，可重新生成" : "尚未安裝";
    const modes = card.querySelector(".modes");
    for (const mode of skill.modes) {
      const pill = document.createElement("span");
      pill.textContent = mode;
      modes.append(pill);
    }
    card.querySelector(".install").textContent = skill.installed ? "重新生成" : "安裝";
    card.querySelector(".install").addEventListener("click", () => beginInstall(skill));
    catalog.append(card);
  }
}

async function beginInstall(skill) {
  const accepted = await ask({
    eyebrow: "INSTALL MSKILL",
    title: `安裝 ${skill.name}？`,
    copy: "MonkeySkill 將把這個 MSkill 的規格與固定測試送到你設定的 LLM API。生成的程式碼尚不會立即安裝。",
    confirm: "是，開始生成"
  });
  if (!accepted) return;
  setBusy(skill.id, true, "LLM 生成與驗證中…");
  showNotice("生成可能需要幾分鐘。你可以重新整理頁面，狀態不會遺失。", false);
  try {
    const response = await rpc("generate", skill.id, 15000);
    if (!response.ok) throw new Error(response.error);
    const draft = await waitForGeneration(skill.id);
    await reviewDraft(draft);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setBusy(skill.id, false);
  }
}

async function reviewDraft(draft) {
  const approved = await ask({
    eyebrow: "VALIDATION PASSED",
    title: "核准安裝生成的 Build？",
    copy: draft.summary,
    details: [
      `Model: ${draft.generation.model}`,
      `Tester: ${draft.generation.testerModel}`,
      `Generation attempts: ${draft.generation.attempts}`,
      `Independent tests: ${draft.testCount}`,
      `Hash: ${draft.generation.hash.slice(0, 16)}`,
      `Validation: ${draft.validation.join(", ")}`,
      ...Object.entries(draft.modes).map(([mode, value]) => `${mode}: JS ${value.jsBytes} bytes / CSS ${value.cssBytes} bytes`)
    ].join("\n"),
    confirm: "是，核准安裝"
  });
  if (!approved) {
    await rpc("discard", draft.skillId);
    showNotice("已捨棄生成的 build。", false);
    return;
  }
  const response = await rpc("approve", draft.skillId, 120000);
  if (!response.ok) throw new Error(response.error);
  showNotice(`${draft.skillName} 已安裝成功。`, false);
  const skill = skills.find(item => item.id === draft.skillId);
  if (skill) { skill.installed = true; skill.source = "llm"; }
  renderCatalog();
}

async function restoreWorkflow() {
  for (const skill of skills) {
    const [statusResponse, pendingResponse] = await Promise.all([
      rpc("status", skill.id),
      rpc("pending", skill.id)
    ]);
    const job = statusResponse.job;
    if (job?.state === "running") {
      setBusy(skill.id, true, "LLM 生成與驗證中…");
      showNotice("背景生成仍在進行；此頁會自動顯示驗證結果。", false);
      try {
        const draft = await waitForGeneration(skill.id);
        await reviewDraft(draft);
      } catch (error) {
        setBusy(skill.id, false, "生成失敗，可重新嘗試");
        showNotice(error.message, true);
      }
    } else if (job?.state === "failed") {
      setBusy(skill.id, false, "生成失敗，可重新嘗試");
      showNotice(job.error, true);
    } else if (pendingResponse.draft) {
      await reviewDraft(pendingResponse.draft);
    }
  }
}

async function waitForGeneration(skillId) {
  const deadline = Date.now() + 21 * 60 * 1000;
  while (Date.now() < deadline) {
    const statusResponse = await rpc("status", skillId);
    if (!statusResponse.ok) throw new Error(statusResponse.error);
    const job = statusResponse.job;
    if (job?.state === "failed") throw new Error(job.error || "生成失敗。");
    if (job?.state === "ready") {
      const pendingResponse = await rpc("pending", skillId);
      if (!pendingResponse.ok) throw new Error(pendingResponse.error);
      if (pendingResponse.draft) return pendingResponse.draft;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("等待生成逾時，請重新嘗試。");
}

function rpc(action, skillId, timeoutMs = 10000) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("MonkeySkill Extension 沒有回應。"));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    window.postMessage({ source: "monkeyskill-store", requestId, action, skillId }, location.origin);
  });
}

function ask({ eyebrow, title, copy, details = "", confirm }) {
  dialogEyebrow.textContent = eyebrow;
  dialogTitle.textContent = title;
  dialogCopy.textContent = copy;
  dialogDetails.textContent = details;
  dialogDetails.hidden = !details;
  dialogConfirm.textContent = confirm;
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}

function setBusy(skillId, busy, text = "") {
  const card = catalog.querySelector(`[data-skill-id="${CSS.escape(skillId)}"]`);
  if (!card) return;
  card.querySelector("button").disabled = busy;
  if (text) card.querySelector(".skill-status").textContent = text;
}

function showNotice(message, error) {
  notice.hidden = false;
  notice.textContent = message;
  notice.classList.toggle("error", error);
}
