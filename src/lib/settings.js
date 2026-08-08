export const SETTINGS_KEY = "restoreRightClickSettings";

export const MODES = Object.freeze({
  OFF: "off",
  STANDARD: "standard",
  ABSOLUTE: "absolute",
  INHERIT: "inherit"
});

export const DEFAULT_SETTINGS = Object.freeze({
  globalMode: MODES.OFF,
  siteOverrides: {}
});

const SCRIPT_PREFIX = "monkeyskill-right-click-";

export function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const globalMode = isRunnableMode(source.globalMode)
    ? source.globalMode
    : MODES.OFF;
  const siteOverrides = {};

  if (source.siteOverrides && typeof source.siteOverrides === "object") {
    for (const [pattern, mode] of Object.entries(source.siteOverrides)) {
      if (isSiteMode(mode) && isSupportedPattern(pattern)) {
        siteOverrides[pattern] = mode;
      }
    }
  }

  return { globalMode, siteOverrides };
}

export function sitePatternFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MonkeySkill only supports regular HTTP and HTTPS pages.");
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export function buildRegistrations(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const registrations = [];
  const overridePatterns = Object.keys(settings.siteOverrides);

  if (isRunnableMode(settings.globalMode)) {
    registrations.push(makeRegistration({
      id: `${SCRIPT_PREFIX}global`,
      mode: settings.globalMode,
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: overridePatterns
    }));
  }

  for (const [pattern, mode] of Object.entries(settings.siteOverrides)) {
    if (!isRunnableMode(mode)) continue;
    registrations.push(makeRegistration({
      id: `${SCRIPT_PREFIX}site-${hash(pattern)}`,
      mode,
      matches: [pattern]
    }));
  }

  return registrations;
}

export function isMonkeySkillRegistration(id) {
  return typeof id === "string" && id.startsWith(SCRIPT_PREFIX);
}

export function isRunnableMode(mode) {
  return mode === MODES.STANDARD || mode === MODES.ABSOLUTE;
}

export function isSiteMode(mode) {
  return mode === MODES.OFF || isRunnableMode(mode);
}

function makeRegistration({ id, mode, matches, excludeMatches = [] }) {
  const basePath = "src/skills/restore-right-click";
  return {
    id,
    matches,
    excludeMatches,
    js: [`${basePath}/${mode}.js`],
    css: [`${basePath}/${mode}.css`],
    runAt: "document_start",
    persistAcrossSessions: true,
    allFrames: true,
    world: "MAIN"
  };
}

function isSupportedPattern(pattern) {
  return /^https?:\/\/[^/]+\/\*$/.test(pattern);
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

