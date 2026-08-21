import {
  INSTALLED_SKILLS_KEY,
  LEGACY_SETTINGS_KEY,
  MODES,
  buildRegistrations,
  buildUserScriptRegistrations,
  defaultConfig,
  installSkillPackage,
  isMonkeySkillRegistration,
  normalizeInstalledSkills,
  sitePatternFromUrl,
  uninstallSkillPackage,
  updateSkillConfig,
  validateSkillManifest
} from "./lib/skill-store.js";
import {
  LLM_SETTINGS_KEY,
  buildGenerationMessages,
  buildTesterMessages,
  endpointOriginPattern,
  extractCriterionIds,
  extractSharedTestFramework,
  normalizeLlmSettings,
  publicLlmSettings,
  scanGeneratedBuild
} from "./lib/llm.js";
import { buildAttackerMessages } from "./lib/security-regression.js";
import {
  buildVerifiedRunnerBootstrapPrompt,
  validateRunnerBootstrapObservation
} from "./lib/runner-bootstrap-policy.js";
import { validateDeveloperConformance } from "./lib/test-spec.js";

const PENDING_BUILDS_KEY = "pendingSkillBuilds";
const GENERATION_JOBS_KEY = "generationJobs";
const TRUSTED_STORES_KEY = "trustedStoreUrls";
const STORE_BRIDGE_PREFIX = "monkeyskill-store-bridge-";
const GENERATION_STALE_MS = 20 * 60 * 1000;
let initializationPromise;
let registrationQueue = Promise.resolve();
let offscreenCreationPromise;
let validationBrowserCreationPromise;

chrome.runtime.onInstalled.addListener(() => {
  initializationPromise = initializeStore();
});

chrome.runtime.onStartup.addListener(() => {
  void ready();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[INSTALLED_SKILLS_KEY]) {
    void queueRegistrationSync(changes[INSTALLED_SKILLS_KEY].newValue);
  }
  if (areaName === "local" && changes[TRUSTED_STORES_KEY]) {
    void syncTrustedStoreBridges(changes[TRUSTED_STORES_KEY].newValue);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (["validation-offscreen", "validation-browser"].includes(message?.target)) return false;
  if (message?.target === "generation-background") {
    void ready()
      .then(() => message.type === "generation-progress"
        ? handleGenerationProgress(message, _sender)
        : handleGenerationCompletion(message, _sender))
      .then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  void ready()
    .then(() => handleMessage(message, _sender))
    .then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
  return true;
});

function ready() {
  initializationPromise ??= initializeStore();
  return initializationPromise;
}

async function initializeStore() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get([
    INSTALLED_SKILLS_KEY,
    LEGACY_SETTINGS_KEY,
    TRUSTED_STORES_KEY
  ]);
  let installed = normalizeInstalledSkills(stored[INSTALLED_SKILLS_KEY]);

  for (const [skillId, record] of Object.entries(installed)) {
    if (record.source.type === "bundled") delete installed[skillId];
  }

  await chrome.storage.local.set({ [INSTALLED_SKILLS_KEY]: installed });
  if (stored[LEGACY_SETTINGS_KEY]) await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
  await queueRegistrationSync(installed);
  await reconcileInterruptedGenerationJobs();
  await syncTrustedStoreBridges(stored[TRUSTED_STORES_KEY]);
}

async function reconcileInterruptedGenerationJobs() {
  if (typeof chrome.offscreen?.hasDocument !== "function") return;
  const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
  const jobs = stored[GENERATION_JOBS_KEY];
  if (!jobs || typeof jobs !== "object" || !Object.values(jobs).some(job => job?.state === "running")) return;
  if (await chrome.offscreen.hasDocument()) return;
  const finishedAt = new Date().toISOString();
  const reconciled = Object.fromEntries(Object.entries(jobs).map(([skillId, job]) => [
    skillId,
    job?.state === "running"
      ? { ...job, state: "failed", updatedAt: finishedAt, finishedAt, error: "Generation was interrupted before completion. Please retry." }
      : job
  ]));
  await chrome.storage.local.set({ [GENERATION_JOBS_KEY]: reconciled });
}

async function handleMessage(message, sender) {
  if (message?.type?.startsWith("store-")) {
    await assertStoreSender(sender);
    message = { ...message, type: message.type.slice("store-".length) };
  }
  const skillId = typeof message?.skillId === "string" ? message.skillId : null;

  switch (message?.type) {
    case "list-installed-skills": {
      const installed = await getInstalledSkills();
      const skills = Object.values(installed).map(record => ({
        id: record.skill.id,
        name: record.skill.name,
        version: record.skill.version,
        description: record.skill.description,
        modes: record.skill.modes,
        source: record.source.type
      }));
      return { ok: true, skills };
    }
    case "verify-runner-bootstrap": {
      const verified = validateRunnerBootstrapObservation(message.bootstrap);
      const prompt = buildVerifiedRunnerBootstrapPrompt(verified, chrome.runtime.getManifest().version);
      return {
        ok: true,
        id: verified.id,
        version: verified.version,
        packageHashPrefix: verified.packageHash.slice(0, 16),
        protocolSchemaVersion: verified.protocolSchemaVersion,
        clipboardText: prompt
      };
    }
    case "reload-extension": {
      assertLocalReloadSender(sender);
      setTimeout(() => chrome.runtime.reload(), 100);
      return { ok: true };
    }
    case "set-test-mode": {
      assertLocalReloadSender(sender);
      requireSkillId(skillId);
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, (config, record) => {
        if (message.mode !== MODES.OFF && !record.skill.modes.includes(message.mode)) {
          throw new Error("Invalid test mode.");
        }
        config.globalMode = message.mode;
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    case "get-state": {
      requireSkillId(skillId);
      const installed = await getInstalledSkills();
      const skill = installed[skillId] ?? null;
      const pattern = message.url ? sitePatternFromUrl(message.url) : null;
      return {
        ok: true,
        skill,
        pattern,
        siteMode: skill && pattern
          ? skill.config.siteOverrides[pattern] ?? MODES.INHERIT
          : null
      };
    }
    case "get-llm-settings": {
      const stored = await chrome.storage.local.get(LLM_SETTINGS_KEY);
      return { ok: true, settings: publicLlmSettings(stored[LLM_SETTINGS_KEY]) };
    }
    case "save-llm-settings": {
      const stored = await chrome.storage.local.get(LLM_SETTINGS_KEY);
      const previous = normalizeLlmSettings(stored[LLM_SETTINGS_KEY]);
      const incoming = normalizeLlmSettings({
        ...message.settings,
        apiKey: message.settings?.apiKey || previous.apiKey
      });
      if (!incoming.model) throw new Error("請填寫模型名稱。");
      if (!incoming.apiKey) throw new Error("請填寫 API key。");
      const granted = await chrome.permissions.contains({
        origins: [endpointOriginPattern(incoming.endpoint)]
      });
      if (!granted) throw new Error("尚未取得 LLM endpoint 的連線權限。");
      await chrome.storage.local.set({ [LLM_SETTINGS_KEY]: incoming });
      return { ok: true, settings: publicLlmSettings(incoming) };
    }
    case "delete-llm-settings": {
      await chrome.storage.local.remove(LLM_SETTINGS_KEY);
      return { ok: true };
    }
    case "list-trusted-stores": {
      const stored = await chrome.storage.local.get(TRUSTED_STORES_KEY);
      return { ok: true, stores: normalizeTrustedStores(stored[TRUSTED_STORES_KEY]) };
    }
    case "add-trusted-store": {
      const normalized = normalizeStoreUrl(message.url);
      const stored = await chrome.storage.local.get(TRUSTED_STORES_KEY);
      const stores = normalizeTrustedStores(stored[TRUSTED_STORES_KEY]);
      if (!isBuiltInStoreRoot(normalized) && !stores.includes(normalized)) stores.push(normalized);
      await chrome.storage.local.set({ [TRUSTED_STORES_KEY]: stores });
      return { ok: true, stores };
    }
    case "remove-trusted-store": {
      const normalized = normalizeStoreUrl(message.url);
      const stored = await chrome.storage.local.get(TRUSTED_STORES_KEY);
      const stores = normalizeTrustedStores(stored[TRUSTED_STORES_KEY]).filter(url => url !== normalized);
      await chrome.storage.local.set({ [TRUSTED_STORES_KEY]: stores });
      return { ok: true, stores };
    }
    case "generate-store-skill": {
      const packageDefinition = validateStorePackage(message.skillPackage, sender);
      const packageSkillId = packageDefinition.skill.id;
      const jobId = crypto.randomUUID();
      await setGenerationJob(packageSkillId, {
        id: jobId,
        state: "running",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      try {
        await ensureUserScriptsAvailable();
        const { request, criteria } = await prepareGenerationRequest(packageDefinition);
        packageDefinition.criteria = criteria;
        await Promise.all([ensureValidationDocument(), ensureValidationBrowserDocument()]);
        const accepted = await chrome.runtime.sendMessage({
          target: "validation-offscreen",
          type: "generate-package",
          jobId,
          skillId: packageSkillId,
          packageDefinition,
          request
        });
        if (!accepted?.ok) throw new Error(accepted?.error || "Generation host did not accept the job.");
        return { ok: true, job: { id: jobId, state: "running" } };
      } catch (error) {
        await setGenerationJob(packageSkillId, {
          id: jobId,
          state: "failed",
          finishedAt: new Date().toISOString(),
          error: error.message
        });
        throw error;
      }
    }
    case "get-generation-status": {
      requireSkillId(skillId);
      const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
      let job = stored[GENERATION_JOBS_KEY]?.[skillId] ?? null;
      if (job?.state === "running" && Date.now() - Date.parse(job.updatedAt || job.startedAt) > GENERATION_STALE_MS) {
        job = {
          ...job,
          state: "failed",
          finishedAt: new Date().toISOString(),
          error: "Generation was interrupted before completion. Please retry."
        };
        await setGenerationJob(skillId, job);
      }
      return { ok: true, job };
    }
    case "clear-generation-history": {
      requireSkillId(skillId);
      const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
      const job = stored[GENERATION_JOBS_KEY]?.[skillId] ?? null;
      if (job?.state === "running") throw new Error("生成仍在執行，不能清除紀錄。");
      if (job?.state === "ready") throw new Error("已有等待核准的 build；請核准或捨棄草稿。");
      await clearGenerationJob(skillId);
      return { ok: true };
    }
    case "get-pending-build": {
      requireSkillId(skillId);
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY]?.[skillId];
      return { ok: true, draft: pending ? publicGeneratedDraft(pending) : null };
    }
    case "approve-generated-skill": {
      requireSkillId(skillId);
      await ensureUserScriptsAvailable();
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY] ?? {};
      const packageDefinition = pending[skillId];
      if (!packageDefinition) throw new Error("沒有等待核准的 generated build。");
      scanGeneratedBuild(packageDefinition.build, packageDefinition.skill);
      await validateUserScriptBuild(packageDefinition);
      const behaviorResults = await validatePackagedBehavior(packageDefinition);
      packageDefinition.build.independentTestResults = behaviorResults;
      const installed = installSkillPackage(await getInstalledSkills(), packageDefinition);
      await saveInstalledSkills(installed);
      delete pending[skillId];
      await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
      await clearGenerationJob(skillId);
      return { ok: true, skill: installed[skillId] };
    }
    case "discard-generated-skill": {
      requireSkillId(skillId);
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY] ?? {};
      delete pending[skillId];
      await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
      await clearGenerationJob(skillId);
      return { ok: true };
    }
    case "uninstall-skill": {
      requireSkillId(skillId);
      const installed = uninstallSkillPackage(await getInstalledSkills(), skillId);
      await saveInstalledSkills(installed);
      return { ok: true };
    }
    case "set-global-mode": {
      requireSkillId(skillId);
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, (config, record) => {
        if (message.mode !== MODES.OFF && !record.skill.modes.includes(message.mode)) {
          throw new Error("Invalid global mode.");
        }
        config.globalMode = message.mode;
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    case "set-site-mode": {
      requireSkillId(skillId);
      const pattern = sitePatternFromUrl(message.url);
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, (config, record) => {
        if (message.mode === MODES.INHERIT) {
          delete config.siteOverrides[pattern];
        } else if (message.mode === MODES.OFF || record.skill.modes.includes(message.mode)) {
          config.siteOverrides[pattern] = message.mode;
        } else {
          throw new Error("Invalid site mode.");
        }
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId], pattern };
    }
    case "remove-site-override": {
      requireSkillId(skillId);
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, config => {
        delete config.siteOverrides[message.pattern];
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    case "reset-skill": {
      requireSkillId(skillId);
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, config => {
        Object.assign(config, defaultConfig());
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    default:
      throw new Error("Unknown MonkeySkill message.");
  }
}

async function loadJsonAsset(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`Unable to load packaged asset: ${path}`);
  return response.json();
}

async function loadTextAsset(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`Unable to load packaged text asset: ${path}`);
  return response.text();
}

function validateStorePackage(value, sender) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MSkill Store did not provide a package.");
  }
  const keys = Object.keys(value);
  if (keys.some(key => !["skill", "instructions", "developerConformance"].includes(key))) {
    throw new Error("MSkill Store packages may contain only a manifest, SKILL.md text, and constrained Developer Conformance.");
  }
  const skill = validateSkillManifest(value.skill);
  if (skill.entrypoint !== "SKILL.md") throw new Error("Store MSkills must use SKILL.md as the entrypoint.");
  if (typeof value.instructions !== "string" || !value.instructions.trim() || value.instructions.length > 100_000) {
    throw new Error("Store MSkill instructions are missing or too large.");
  }
  return {
    skill,
    specification: { instructions: value.instructions },
    developerConformance: value.developerConformance ?? null,
    source: {
      type: "store",
      storeUrl: sender.url,
      packagePath: null,
      skillPath: null,
      buildPath: null
    }
  };
}

async function resolveSkillInstructions(packageDefinition) {
  const inline = packageDefinition.specification?.instructions;
  if (typeof inline === "string" && inline.trim()) return inline;
  const skillPath = packageDefinition.source?.skillPath;
  if (!skillPath) throw new Error("Generated Skill is missing its human-readable specification.");
  const skillRoot = skillPath.slice(0, skillPath.lastIndexOf("/") + 1);
  return loadTextAsset(`${skillRoot}${packageDefinition.skill.entrypoint}`);
}

function requireSkillId(skillId) {
  if (!skillId) throw new Error("A Skill id is required.");
}

async function prepareGenerationRequest(packageDefinition) {
  const stored = await chrome.storage.local.get(LLM_SETTINGS_KEY);
  const settings = normalizeLlmSettings(stored[LLM_SETTINGS_KEY]);
  if (!settings.model || !settings.apiKey) throw new Error("請先在設定頁保存自己的 LLM API。");

  const [attackerInstructions, installerInstructions, testerInstructions, skillInstructions] = await Promise.all([
    loadAgentSkill("mskill-attacker"),
    loadAgentSkill("mskill-installer"),
    loadAgentSkill("mskill-tester"),
    resolveSkillInstructions(packageDefinition)
  ]);
  const builderMessages = buildGenerationMessages({
    installerInstructions,
    testFrameworkInstructions: extractSharedTestFramework(testerInstructions),
    skillInstructions,
    skill: packageDefinition.skill
  });
  const testerMessages = buildTesterMessages({
    testerInstructions,
    skillInstructions,
    skill: packageDefinition.skill
  });
  const attackerMessages = buildAttackerMessages({
    attackerInstructions,
    skillInstructions,
    skill: packageDefinition.skill
  });
  const criteria = extractCriterionIds(skillInstructions);
  if (criteria.length === 0) throw new Error("MSkill must declare human-readable criterion IDs in SKILL.md.");
  if (packageDefinition.developerConformance) {
    packageDefinition.developerConformance = validateDeveloperConformance(
      packageDefinition.developerConformance,
      packageDefinition.skill,
      criteria
    );
  }

  return {
    request: {
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      attackerBody: {
        model: settings.model,
        messages: attackerMessages,
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      builderBody: {
        model: settings.model,
        messages: builderMessages,
        temperature: 0,
        response_format: { type: "json_object" }
      },
      testerBody: {
        model: settings.model,
        messages: testerMessages,
        temperature: 0,
        response_format: { type: "json_object" }
      }
    },
    criteria
  };
}

async function handleGenerationCompletion(message, sender) {
  if (sender?.url !== chrome.runtime.getURL("src/validation/offscreen.html")) {
    throw new Error("Invalid generation completion sender.");
  }
  const storedJobs = await chrome.storage.local.get(GENERATION_JOBS_KEY);
  const activeJob = storedJobs[GENERATION_JOBS_KEY]?.[message.skillId];
  if (!activeJob || activeJob.id !== message.jobId || activeJob.state !== "running") {
    return { ok: false, ignored: true };
  }
  if (!message.ok) {
    await setGenerationJob(message.skillId, {
      ...activeJob,
      state: "failed",
      finishedAt: new Date().toISOString(),
      error: message.error || "Generation failed."
    });
    return { ok: true };
  }

  try {
    const generatedPackage = message.packageDefinition;
    await validateUserScriptBuild(generatedPackage);
    generatedPackage.build.validation.push("chrome-userScripts-parse");
    const publicTestResults = generatedPackage.build.publicTestResults ?? generatedPackage.build.selfTestResults ?? [];
    const publicPassedCount = publicTestResults.filter(result => result.ok).length;
    const publicInconclusiveCount = publicTestResults.filter(result => result.inconclusive).length;
    generatedPackage.build.validation.push(`public-testspec:${publicPassedCount}/${publicTestResults.length}`);
    if (publicInconclusiveCount > 0) generatedPackage.build.validation.push(`public-testspec-inconclusive:${publicInconclusiveCount}`);
    const developerResults = generatedPackage.build.developerConformanceResults ?? [];
    const developerPassedCount = developerResults.filter(result => result.ok).length;
    const developerBlockedCount = developerResults.filter(result => !result.ok).length;
    if (developerBlockedCount > 0) throw new Error("Developer Conformance cannot be failed or inconclusive at approval.");
    if (generatedPackage.build.developerConformance) {
      generatedPackage.build.validation.push(`developer-conformance:${developerPassedCount}/${developerResults.length}`);
    }
    const independentTestResults = generatedPackage.build.independentTestResults ?? generatedPackage.build.behaviorTests ?? [];
    const inconclusiveCount = independentTestResults.filter(result => result.inconclusive).length;
    const passedCount = independentTestResults.filter(result => result.ok).length;
    generatedPackage.build.validation.push(`independent-testspec:${passedCount}/${independentTestResults.length}`);
    if (inconclusiveCount > 0) generatedPackage.build.validation.push(`behavior-inconclusive:${inconclusiveCount}`);
    const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
    const pending = stored[PENDING_BUILDS_KEY] && typeof stored[PENDING_BUILDS_KEY] === "object"
      ? stored[PENDING_BUILDS_KEY]
      : {};
    pending[message.skillId] = generatedPackage;
    await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
    await setGenerationJob(message.skillId, {
      id: message.jobId,
      state: "ready",
      finishedAt: new Date().toISOString(),
      validation: generatedPackage.build.validation
    });
    return { ok: true };
  } catch (error) {
    await setGenerationJob(message.skillId, {
      ...activeJob,
      state: "failed",
      finishedAt: new Date().toISOString(),
      error: error.message
    });
    return { ok: true };
  }
}

async function handleGenerationProgress(message, sender) {
  if (sender?.url !== chrome.runtime.getURL("src/validation/offscreen.html")) {
    throw new Error("Invalid generation progress sender.");
  }
  const storedJobs = await chrome.storage.local.get(GENERATION_JOBS_KEY);
  const activeJob = storedJobs[GENERATION_JOBS_KEY]?.[message.skillId];
  if (!activeJob || activeJob.id !== message.jobId || activeJob.state !== "running") {
    return { ok: false, ignored: true };
  }
  await setGenerationJob(message.skillId, {
    ...activeJob,
    updatedAt: new Date().toISOString(),
    stage: typeof message.stage === "string" ? message.stage : activeJob.stage
  });
  return { ok: true };
}

async function loadAgentSkill(skillId) {
  const catalog = await loadJsonAsset("agent-skills.json");
  const entry = catalog.find(candidate => candidate.id === skillId && candidate.preinstall);
  if (!entry) throw new Error(`Agent Skill is not available: ${skillId}`);
  return loadTextAsset(entry.entrypoint);
}

async function ensureUserScriptsAvailable() {
  if (!chrome.userScripts) throw new Error("請先在擴充套件詳細頁開啟 Allow User Scripts。");
  try {
    await chrome.userScripts.getScripts();
  } catch {
    throw new Error("請先在擴充套件詳細頁開啟 Allow User Scripts。");
  }
}

async function validateUserScriptBuild(packageDefinition) {
  const records = installSkillPackage({}, packageDefinition);
  const configured = updateSkillConfig(records, packageDefinition.skill.id, config => {
    config.siteOverrides["http://127.0.0.1:4173/*"] = packageDefinition.skill.modes[0];
  });
  const scripts = buildUserScriptRegistrations(configured).map((script, index) => ({
    ...script,
    id: `monkeyskill-validation-${Date.now()}-${index}`
  }));
  try {
    await chrome.userScripts.register(scripts);
  } finally {
    if (scripts.length > 0) {
      await chrome.userScripts.unregister({ ids: scripts.map(script => script.id) }).catch(() => undefined);
    }
  }
}

async function validatePackagedBehavior(packageDefinition) {
  const skillInstructions = await resolveSkillInstructions(packageDefinition);
  const criteria = extractCriterionIds(skillInstructions);
  const testSpec = packageDefinition.build.independentTestSpec ?? packageDefinition.build.testSpec;
  if (!testSpec) throw new Error("Generated build is missing its Independent TestSpec.");
  await ensureValidationDocument();
  const response = await chrome.runtime.sendMessage({
    target: "validation-offscreen",
    type: "run-behavior-tests",
    testSpec,
    criteria,
    skill: packageDefinition.skill,
    build: packageDefinition.build
  });
  if (!response?.results) throw new Error(response?.error || "Behavior test runner did not respond.");
  const failed = response.results.filter(result => !result.ok && !result.inconclusive);
  if (failed.length > 0) {
    const detail = failed.map(result => `${result.criterion}:${result.category}`).join("; ");
    throw new Error(`Generated build failed behavior tests (${failed.length}/${response.results.length}): ${detail}`);
  }
  const developerTestSpec = packageDefinition.build.developerConformance;
  if (developerTestSpec) {
    const stored = await chrome.storage.local.get(LLM_SETTINGS_KEY);
    const settings = normalizeLlmSettings(stored[LLM_SETTINGS_KEY]);
    let developerResponse;
    if (settings.apiKey && isLocalAgentEndpoint(settings.endpoint)) {
      developerResponse = await runLocalRealBrowserConformance(settings, developerTestSpec, packageDefinition.build);
    } else {
      await ensureValidationBrowserDocument();
      developerResponse = await chrome.runtime.sendMessage({
        target: "validation-browser",
        type: "run-developer-conformance",
        testSpec: developerTestSpec,
        criteria,
        skill: packageDefinition.skill,
        build: packageDefinition.build
      });
    }
    if (!developerResponse?.results) throw new Error(developerResponse?.error || "Developer Conformance runner did not respond.");
    const blocked = developerResponse.results.filter(result => !result.ok);
    if (blocked.length > 0) {
      const detail = blocked.map(result => `${result.criterion}:${result.category}`).join("; ");
      throw new Error(`Generated build failed Developer Conformance (${blocked.length}/${developerResponse.results.length}): ${detail}`);
    }
    packageDefinition.build.developerConformanceResults = developerResponse.results;
  }
  return response.results;
}

async function runLocalRealBrowserConformance(settings, testSpec, build) {
  const endpoint = new URL("/v1/real-browser-conformance", settings.endpoint);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${settings.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ testSpec, build })
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return payload;
    if (response.status < 500 || attempt === 1) {
      throw new Error(payload?.error?.message || `Real-browser Developer Conformance returned HTTP ${response.status}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

function isLocalAgentEndpoint(endpoint) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

async function ensureValidationDocument() {
  const url = chrome.runtime.getURL("src/validation/offscreen.html");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts.length > 0) return;
  } else if (await chrome.offscreen.hasDocument()) {
    return;
  }
  offscreenCreationPromise ??= chrome.offscreen.createDocument({
    url: "src/validation/offscreen.html",
    reasons: ["IFRAME_SCRIPTING"],
    justification: "Run constrained MSkill validation in an isolated Extension document."
  }).finally(() => {
    offscreenCreationPromise = null;
  });
  await offscreenCreationPromise;
}

async function ensureValidationBrowserDocument() {
  const url = chrome.runtime.getURL("src/validation/offscreen.html?backend=browser");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [url]
    });
    if (contexts.length > 0) return;
  }
  validationBrowserCreationPromise ??= chrome.tabs.create({ url, active: false }).then(async tab => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current?.status === "complete") return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Browser-backed validation document did not finish loading.");
  }).finally(() => {
    validationBrowserCreationPromise = null;
  });
  await validationBrowserCreationPromise;
}

async function setGenerationJob(skillId, job) {
  const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
  const jobs = stored[GENERATION_JOBS_KEY] && typeof stored[GENERATION_JOBS_KEY] === "object"
    ? stored[GENERATION_JOBS_KEY]
    : {};
  jobs[skillId] = job;
  await chrome.storage.local.set({ [GENERATION_JOBS_KEY]: jobs });
}

async function clearGenerationJob(skillId) {
  const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
  const jobs = stored[GENERATION_JOBS_KEY] && typeof stored[GENERATION_JOBS_KEY] === "object"
    ? stored[GENERATION_JOBS_KEY]
    : {};
  delete jobs[skillId];
  await chrome.storage.local.set({ [GENERATION_JOBS_KEY]: jobs });
}

function publicGeneratedDraft(packageDefinition) {
  const { build, skill } = packageDefinition;
  return {
    skillId: skill.id,
    skillName: skill.name,
    summary: build.summary,
    validation: build.validation,
    generation: build.generation,
    publicTestCount: Array.isArray((build.publicTestSpec ?? build.selfTests)?.tests)
      ? (build.publicTestSpec ?? build.selfTests).tests.length
      : 0,
    publicTestInconclusiveCount: Array.isArray(build.publicTestResults ?? build.selfTestResults)
      ? (build.publicTestResults ?? build.selfTestResults).filter(result => result.inconclusive).length
      : 0,
    independentTestCount: Array.isArray((build.independentTestSpec ?? build.testSpec)?.tests)
      ? (build.independentTestSpec ?? build.testSpec).tests.length
      : 0,
    independentTestInconclusiveCount: Array.isArray(build.independentTestResults ?? build.behaviorTests)
      ? (build.independentTestResults ?? build.behaviorTests).filter(result => result.inconclusive).length
      : 0,
    developerConformanceCount: Array.isArray(build.developerConformance?.tests)
      ? build.developerConformance.tests.length
      : 0,
    developerConformancePassCount: Array.isArray(build.developerConformanceResults)
      ? build.developerConformanceResults.filter(result => result.ok).length
      : 0,
    developerConformanceInconclusiveCount: Array.isArray(build.developerConformanceResults)
      ? build.developerConformanceResults.filter(result => result.inconclusive).length
      : 0,
    modes: Object.fromEntries(Object.entries(build.modes).map(([mode, artifact]) => [mode, {
      js: artifact.js,
      css: artifact.css,
      jsBytes: new TextEncoder().encode(artifact.js).length,
      cssBytes: new TextEncoder().encode(artifact.css).length
    }]))
  };
}

async function assertStoreSender(sender) {
  let url;
  try {
    url = new URL(sender?.url);
  } catch {
    throw new Error("Invalid MSkill Store sender.");
  }
  const localStore = ["http://127.0.0.1:4174", "http://localhost:4174"].includes(url.origin)
    && ["/", "/index.html"].includes(url.pathname);
  const officialStore = url.origin === "https://allenyllee.github.io"
    && (url.pathname === "/monkeyskill-store/" || url.pathname === "/monkeyskill-store/index.html");
  const stored = await chrome.storage.local.get(TRUSTED_STORES_KEY);
  const customStore = normalizeTrustedStores(stored[TRUSTED_STORES_KEY]).some(value => {
    const trusted = new URL(value);
    return url.origin === trusted.origin
      && (url.pathname === trusted.pathname || url.pathname === `${trusted.pathname}index.html`);
  });
  if (!localStore && !officialStore && !customStore) {
    throw new Error("This request is not from an approved MSkill Store.");
  }
}

function assertLocalReloadSender(sender) {
  let url;
  try {
    url = new URL(sender?.url);
  } catch {
    throw new Error("Invalid local Store sender.");
  }
  const allowed = url.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && url.port === "4174"
    && ["/", "/index.html"].includes(url.pathname);
  if (!allowed) throw new Error("Extension reload is available only to the local development Store.");
}

function normalizeTrustedStores(value) {
  if (!Array.isArray(value)) return [];
  const stores = [];
  for (const item of value) {
    try {
      const normalized = normalizeStoreUrl(item);
      if (!isBuiltInStoreRoot(normalized) && !stores.includes(normalized)) stores.push(normalized);
    } catch {
      // Invalid persisted entries are ignored instead of receiving a bridge.
    }
  }
  return stores;
}

function normalizeStoreUrl(value) {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("Store URLs must use HTTPS; localhost is allowed for development.");
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/index.html")) url.pathname = url.pathname.slice(0, -"index.html".length);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function isBuiltInStoreRoot(value) {
  return [
    "https://allenyllee.github.io/monkeyskill-store/",
    "http://127.0.0.1:4174/",
    "http://localhost:4174/"
  ].includes(value);
}

async function syncTrustedStoreBridges(value) {
  const current = await chrome.scripting.getRegisteredContentScripts();
  const ids = current.map(script => script.id).filter(id => id.startsWith(STORE_BRIDGE_PREFIX));
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
  const stores = normalizeTrustedStores(value);
  const approved = [];
  for (const value of stores) {
    const url = new URL(value);
    if (await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) approved.push(value);
  }
  if (approved.length === 0) return;
  await chrome.scripting.registerContentScripts(approved.map((value, index) => {
    const url = new URL(value);
    return {
      id: `${STORE_BRIDGE_PREFIX}${index}`,
      matches: [`${url.origin}${url.pathname}*`],
      js: ["src/store/bridge.js"],
      runAt: "document_start",
      persistAcrossSessions: true
    };
  }));
}

async function getInstalledSkills() {
  const stored = await chrome.storage.local.get(INSTALLED_SKILLS_KEY);
  return normalizeInstalledSkills(stored[INSTALLED_SKILLS_KEY]);
}

async function saveInstalledSkills(installed) {
  const normalized = normalizeInstalledSkills(installed);
  await chrome.storage.local.set({ [INSTALLED_SKILLS_KEY]: normalized });
  await queueRegistrationSync(normalized);
}

function queueRegistrationSync(installed) {
  registrationQueue = registrationQueue
    .catch(() => undefined)
    .then(() => syncRegistrations(installed));
  return registrationQueue;
}

async function syncRegistrations(installed) {
  const current = await chrome.scripting.getRegisteredContentScripts();
  const ids = current.map(script => script.id).filter(isMonkeySkillRegistration);
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });

  const desired = buildRegistrations(installed);
  if (desired.length > 0) await chrome.scripting.registerContentScripts(desired);

  const desiredUserScripts = buildUserScriptRegistrations(installed);
  if (!chrome.userScripts) return;
  const currentUserScripts = await chrome.userScripts.getScripts().catch(() => []);
  const userScriptIds = currentUserScripts.map(script => script.id).filter(isMonkeySkillRegistration);
  if (userScriptIds.length > 0) await chrome.userScripts.unregister({ ids: userScriptIds });
  if (desiredUserScripts.length > 0) await chrome.userScripts.register(desiredUserScripts);
}
