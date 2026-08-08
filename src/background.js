import {
  INSTALLED_SKILLS_KEY,
  LEGACY_SETTINGS_KEY,
  MODES,
  SEEDED_PREINSTALLED_KEY,
  buildRegistrations,
  defaultConfig,
  installSkillPackage,
  isMonkeySkillRegistration,
  normalizeInstalledSkills,
  sitePatternFromUrl,
  uninstallSkillPackage,
  updateSkillConfig
} from "./lib/skill-store.js";

const PRIMARY_SKILL_ID = "restore-right-click";
let initializationPromise;
let registrationQueue = Promise.resolve();

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
      installed = installSkillPackage(installed, packageDefinition);
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
    case "install-bundled-skill": {
      const registry = await loadJsonAsset("preinstalled-skills.json");
      const entry = registry.find(candidate => candidate.package === `packages/${skillId}.mskill.json`);
      if (!entry) throw new Error(`Bundled Skill not found: ${skillId}`);
      const packageDefinition = await loadBundledPackage(entry);
      const installed = installSkillPackage(await getInstalledSkills(), packageDefinition);
      await saveInstalledSkills(installed);
      return { ok: true, skill: installed[skillId] };
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
}
