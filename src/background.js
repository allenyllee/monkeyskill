import {
  DEFAULT_SETTINGS,
  MODES,
  SETTINGS_KEY,
  buildRegistrations,
  isMonkeySkillRegistration,
  isRunnableMode,
  isSiteMode,
  normalizeSettings,
  sitePatternFromUrl
} from "./lib/settings.js";

let registrationQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings().then(queueRegistrationSync);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings().then(queueRegistrationSync);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    void queueRegistrationSync(changes[SETTINGS_KEY].newValue);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse, error => {
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "get-state": {
      const settings = await getSettings();
      const pattern = message.url ? sitePatternFromUrl(message.url) : null;
      return {
        ok: true,
        settings,
        pattern,
        siteMode: pattern ? settings.siteOverrides[pattern] ?? MODES.INHERIT : null
      };
    }
    case "set-global-mode": {
      if (message.mode !== MODES.OFF && !isRunnableMode(message.mode)) {
        throw new Error("Invalid global mode.");
      }
      const settings = await getSettings();
      settings.globalMode = message.mode;
      await saveSettings(settings);
      return { ok: true, settings };
    }
    case "set-site-mode": {
      const pattern = sitePatternFromUrl(message.url);
      const settings = await getSettings();
      if (message.mode === MODES.INHERIT) {
        delete settings.siteOverrides[pattern];
      } else if (isSiteMode(message.mode)) {
        settings.siteOverrides[pattern] = message.mode;
      } else {
        throw new Error("Invalid site mode.");
      }
      await saveSettings(settings);
      return { ok: true, settings, pattern };
    }
    case "remove-site-override": {
      const settings = await getSettings();
      delete settings.siteOverrides[message.pattern];
      await saveSettings(settings);
      return { ok: true, settings };
    }
    case "reset-skill": {
      await saveSettings(structuredClone(DEFAULT_SETTINGS));
      return { ok: true };
    }
    default:
      throw new Error("Unknown MonkeySkill message.");
  }
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = normalizeSettings(stored[SETTINGS_KEY]);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  await queueRegistrationSync(normalized);
}

function queueRegistrationSync(settings) {
  registrationQueue = registrationQueue
    .catch(() => undefined)
    .then(() => syncRegistrations(settings));
  return registrationQueue;
}

async function syncRegistrations(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const current = await chrome.scripting.getRegisteredContentScripts();
  const ids = current
    .map(script => script.id)
    .filter(isMonkeySkillRegistration);

  if (ids.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids });
  }

  const desired = buildRegistrations(settings);
  if (desired.length > 0) {
    await chrome.scripting.registerContentScripts(desired);
  }
}
