import {
  INSTALLED_SKILLS_KEY,
  LEGACY_SETTINGS_KEY,
  MODES,
  SEEDED_PREINSTALLED_KEY,
  buildRegistrations,
  buildUserScriptRegistrations,
  defaultConfig,
  installSkillPackage,
  isMonkeySkillRegistration,
  normalizeInstalledSkills,
  sitePatternFromUrl,
  uninstallSkillPackage,
  updateSkillConfig
} from "./lib/skill-store.js";
import {
  LLM_SETTINGS_KEY,
  buildGenerationMessages,
  endpointOriginPattern,
  extractAssistantText,
  normalizeLlmSettings,
  parseGeneratedBuild,
  publicLlmSettings,
  scanGeneratedBuild
} from "./lib/llm.js";

const PRIMARY_SKILL_ID = "restore-right-click";
const PENDING_BUILDS_KEY = "pendingSkillBuilds";
const GENERATION_JOBS_KEY = "generationJobs";
let initializationPromise;
let registrationQueue = Promise.resolve();
let offscreenCreationPromise;

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
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === "validation-offscreen") return false;
  void ready()
    .then(() => handleMessage(message))
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
    SEEDED_PREINSTALLED_KEY,
    LEGACY_SETTINGS_KEY
  ]);
  let installed = normalizeInstalledSkills(stored[INSTALLED_SKILLS_KEY]);
  const seeded = new Set(Array.isArray(stored[SEEDED_PREINSTALLED_KEY])
    ? stored[SEEDED_PREINSTALLED_KEY]
    : []);
  const registry = await loadJsonAsset("preinstalled-skills.json");

  for (const entry of registry) {
    if (!entry.preinstall) continue;
    const packageDefinition = await loadBundledPackage(entry);
    const skillId = packageDefinition.skill.id;
    if (installed[skillId]) {
      if (installed[skillId].source.type === "bundled") {
        installed = installSkillPackage(installed, packageDefinition);
      }
      seeded.add(skillId);
      continue;
    }
    if (seeded.has(skillId)) continue;

    installed = installSkillPackage(installed, packageDefinition);
    if (skillId === PRIMARY_SKILL_ID && stored[LEGACY_SETTINGS_KEY]) {
      installed[skillId].config = {
        ...defaultConfig(),
        ...stored[LEGACY_SETTINGS_KEY]
      };
    }
    seeded.add(skillId);
  }

  await chrome.storage.local.set({
    [INSTALLED_SKILLS_KEY]: installed,
    [SEEDED_PREINSTALLED_KEY]: [...seeded]
  });
  if (stored[LEGACY_SETTINGS_KEY]) await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
  await queueRegistrationSync(installed);
}

async function handleMessage(message) {
  const skillId = message?.skillId ?? PRIMARY_SKILL_ID;

  switch (message?.type) {
    case "get-state": {
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
    case "install-bundled-skill": {
      const registry = await loadJsonAsset("preinstalled-skills.json");
      const entry = registry.find(candidate => candidate.package === `packages/${skillId}.mskill.json`);
      if (!entry) throw new Error(`Bundled Skill not found: ${skillId}`);
      const packageDefinition = await loadBundledPackage(entry);
      const installed = installSkillPackage(await getInstalledSkills(), packageDefinition);
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    case "generate-bundled-skill": {
      const jobId = crypto.randomUUID();
      await setGenerationJob(skillId, {
        id: jobId,
        state: "running",
        startedAt: new Date().toISOString()
      });
      try {
        await ensureUserScriptsAvailable();
        const registry = await loadJsonAsset("preinstalled-skills.json");
        const entry = registry.find(candidate => candidate.package === `packages/${skillId}.mskill.json`);
        if (!entry) throw new Error(`Bundled MSkill not found: ${skillId}`);
        const packageDefinition = await loadBundledPackage(entry);
        const generatedPackage = await generatePackage(packageDefinition);
        await validateUserScriptBuild(generatedPackage);
        generatedPackage.build.validation.push("chrome-userScripts-parse");
        const behaviorResults = await validatePackagedBehavior(generatedPackage);
        generatedPackage.build.behaviorTests = behaviorResults;
        generatedPackage.build.validation.push(`behavior-tests:${behaviorResults.length}/${behaviorResults.length}`);
        const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
        const pending = stored[PENDING_BUILDS_KEY] && typeof stored[PENDING_BUILDS_KEY] === "object"
          ? stored[PENDING_BUILDS_KEY]
          : {};
        pending[skillId] = generatedPackage;
        await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
        await setGenerationJob(skillId, {
          id: jobId,
          state: "ready",
          finishedAt: new Date().toISOString(),
          validation: generatedPackage.build.validation
        });
        return {
          ok: true,
          draft: publicGeneratedDraft(generatedPackage)
        };
      } catch (error) {
        await setGenerationJob(skillId, {
          id: jobId,
          state: "failed",
          finishedAt: new Date().toISOString(),
          error: error.message
        });
        throw error;
      }
    }
    case "get-generation-status": {
      const stored = await chrome.storage.local.get(GENERATION_JOBS_KEY);
      return { ok: true, job: stored[GENERATION_JOBS_KEY]?.[skillId] ?? null };
    }
    case "get-pending-build": {
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY]?.[skillId];
      return { ok: true, draft: pending ? publicGeneratedDraft(pending) : null };
    }
    case "approve-generated-skill": {
      await ensureUserScriptsAvailable();
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY] ?? {};
      const packageDefinition = pending[skillId];
      if (!packageDefinition) throw new Error("沒有等待核准的 generated build。");
      scanGeneratedBuild(packageDefinition.build, packageDefinition.skill);
      await validateUserScriptBuild(packageDefinition);
      const behaviorResults = await validatePackagedBehavior(packageDefinition);
      packageDefinition.build.behaviorTests = behaviorResults;
      const installed = installSkillPackage(await getInstalledSkills(), packageDefinition);
      await saveInstalledSkills(installed);
      delete pending[skillId];
      await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
      await clearGenerationJob(skillId);
      return { ok: true, skill: installed[skillId] };
    }
    case "discard-generated-skill": {
      const stored = await chrome.storage.local.get(PENDING_BUILDS_KEY);
      const pending = stored[PENDING_BUILDS_KEY] ?? {};
      delete pending[skillId];
      await chrome.storage.local.set({ [PENDING_BUILDS_KEY]: pending });
      await clearGenerationJob(skillId);
      return { ok: true };
    }
    case "uninstall-skill": {
      const installed = uninstallSkillPackage(await getInstalledSkills(), skillId);
      await saveInstalledSkills(installed);
      return { ok: true };
    }
    case "set-global-mode": {
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
      const installed = updateSkillConfig(await getInstalledSkills(), skillId, config => {
        delete config.siteOverrides[message.pattern];
      });
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
    }
    case "reset-skill": {
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

async function loadBundledPackage(entry) {
  const descriptor = await loadJsonAsset(entry.package);
  const [skill, build] = await Promise.all([
    loadJsonAsset(descriptor.skill),
    loadJsonAsset(descriptor.build)
  ]);
  if (descriptor.id !== skill.id) throw new Error("Package does not match its Skill manifest.");
  return {
    skill,
    build,
    source: {
      type: "bundled",
      packagePath: entry.package,
      skillPath: descriptor.skill,
      buildPath: descriptor.build
    }
  };
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

async function generatePackage(packageDefinition) {
  const stored = await chrome.storage.local.get(LLM_SETTINGS_KEY);
  const settings = normalizeLlmSettings(stored[LLM_SETTINGS_KEY]);
  if (!settings.model || !settings.apiKey) throw new Error("請先在設定頁保存自己的 LLM API。");

  const skillPath = packageDefinition.source.skillPath;
  const skillRoot = skillPath.slice(0, skillPath.lastIndexOf("/") + 1);
  const [installerInstructions, skillInstructions, tests] = await Promise.all([
    loadAgentSkill("mskill-installer"),
    loadTextAsset(`${skillRoot}${packageDefinition.skill.entrypoint}`),
    loadJsonAsset(`${skillRoot}${packageDefinition.skill.tests}`)
  ]);
  const testRunner = tests.runner ? await loadTextAsset(`${skillRoot}${tests.runner}`) : "";
  const messages = buildGenerationMessages({
    installerInstructions,
    skillInstructions,
    skill: packageDefinition.skill,
    tests,
    testRunner
  });

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${settings.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`LLM API request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const build = parseGeneratedBuild(extractAssistantText(payload), packageDefinition.skill);
  build.validation = scanGeneratedBuild(build, packageDefinition.skill);
  build.generation = {
    provider: new URL(settings.endpoint).origin,
    model: settings.model,
    generatedAt: new Date().toISOString(),
    hash: await sha256(JSON.stringify(build.modes))
  };
  return {
    skill: packageDefinition.skill,
    build,
    source: {
      type: "llm",
      packagePath: packageDefinition.source.packagePath,
      skillPath: packageDefinition.source.skillPath,
      buildPath: null
    }
  };
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
    config.siteOverrides["https://monkeyskill-validation.invalid/*"] = packageDefinition.skill.modes[0];
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
  const skillPath = packageDefinition.source.skillPath;
  if (!skillPath) throw new Error("Generated Skill is missing its packaged test location.");
  const skillRoot = skillPath.slice(0, skillPath.lastIndexOf("/") + 1);
  const suite = await loadJsonAsset(`${skillRoot}${packageDefinition.skill.tests}`);
  if (typeof suite.runner !== "string" || !suite.runner || !Array.isArray(suite.tests)) {
    throw new Error("MSkill must include an executable browser test suite.");
  }
  const runnerSource = await loadTextAsset(`${skillRoot}${suite.runner}`);
  await ensureValidationDocument();
  const response = await chrome.runtime.sendMessage({
    target: "validation-offscreen",
    type: "run-behavior-tests",
    suite,
    runnerSource,
    build: packageDefinition.build
  });
  if (!response?.results) throw new Error(response?.error || "Behavior test runner did not respond.");
  const failed = response.results.filter(result => !result.ok);
  if (failed.length > 0) {
    const detail = failed.map(result => `${result.id}: ${result.error}`).join("; ");
    throw new Error(`Generated build failed behavior tests (${failed.length}/${response.results.length}): ${detail}`);
  }
  return response.results;
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
    justification: "Run packaged MSkill acceptance tests in isolated sandbox frames before installation."
  }).finally(() => {
    offscreenCreationPromise = null;
  });
  await offscreenCreationPromise;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
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
    modes: Object.fromEntries(Object.entries(build.modes).map(([mode, artifact]) => [mode, {
      js: artifact.js,
      css: artifact.css,
      jsBytes: new TextEncoder().encode(artifact.js).length,
      cssBytes: new TextEncoder().encode(artifact.css).length
    }]))
  };
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
