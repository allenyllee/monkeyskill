export const INSTALLED_SKILLS_KEY = "installedSkills";
export const SEEDED_PREINSTALLED_KEY = "seededPreinstalledSkills";
export const LEGACY_SETTINGS_KEY = "restoreRightClickSettings";

export const MODES = Object.freeze({
  OFF: "off",
  STANDARD: "standard",
  ABSOLUTE: "absolute",
  INHERIT: "inherit"
});

const REGISTRATION_PREFIX = "monkeyskill-installed-";

export function defaultConfig() {
  return {
    globalMode: MODES.OFF,
    siteOverrides: {}
  };
}

export function normalizeConfig(value, availableModes = [MODES.STANDARD, MODES.ABSOLUTE]) {
  const source = value && typeof value === "object" ? value : {};
  const allowed = new Set(availableModes);
  const globalMode = allowed.has(source.globalMode) ? source.globalMode : MODES.OFF;
  const siteOverrides = {};

  if (source.siteOverrides && typeof source.siteOverrides === "object") {
    for (const [pattern, mode] of Object.entries(source.siteOverrides)) {
      if (isSupportedPattern(pattern) && (mode === MODES.OFF || allowed.has(mode))) {
        siteOverrides[pattern] = mode;
      }
    }
  }

  return { globalMode, siteOverrides };
}

export function normalizeInstalledSkills(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};

  for (const [id, record] of Object.entries(source)) {
    try {
      const normalized = normalizeInstalledRecord(record);
      if (normalized.skill.id === id) result[id] = normalized;
    } catch {
      // Invalid records are deliberately ignored rather than executed.
    }
  }

  return result;
}

export function installSkillPackage(installedSkills, packageDefinition) {
  const current = normalizeInstalledSkills(installedSkills);
  const skill = validateSkillManifest(packageDefinition?.skill);
  const build = validateBuildManifest(packageDefinition?.build, skill);
  const previous = current[skill.id];

  return {
    ...current,
    [skill.id]: {
      skill,
      build,
      source: normalizeSource(packageDefinition.source),
      installedAt: previous?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: normalizeConfig(previous?.config, skill.modes)
    }
  };
}

export function uninstallSkillPackage(installedSkills, skillId) {
  const result = normalizeInstalledSkills(installedSkills);
  delete result[skillId];
  return result;
}

export function updateSkillConfig(installedSkills, skillId, updater) {
  const result = normalizeInstalledSkills(installedSkills);
  const record = result[skillId];
  if (!record) throw new Error(`Skill is not installed: ${skillId}`);
  const draft = structuredClone(record.config);
  updater(draft, record);
  record.config = normalizeConfig(draft, record.skill.modes);
  record.updatedAt = new Date().toISOString();
  return result;
}

export function sitePatternFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MonkeySkill only supports regular HTTP and HTTPS pages.");
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export function buildRegistrations(installedSkills) {
  const installed = normalizeInstalledSkills(installedSkills);
  const registrations = [];

  for (const record of Object.values(installed)) {
    const { skill, build, config } = record;
    const overridePatterns = Object.keys(config.siteOverrides);

    if (skill.modes.includes(config.globalMode)) {
      registrations.push(makeRegistration({
        record,
        id: `${REGISTRATION_PREFIX}${hash(skill.id)}-global`,
        mode: config.globalMode,
        matches: ["http://*/*", "https://*/*"],
        excludeMatches: overridePatterns
      }));
    }

    for (const [pattern, mode] of Object.entries(config.siteOverrides)) {
      if (!skill.modes.includes(mode)) continue;
      registrations.push(makeRegistration({
        record,
        id: `${REGISTRATION_PREFIX}${hash(skill.id)}-site-${hash(pattern)}`,
        mode,
        matches: [pattern]
      }));
    }

    if (build.artifactType !== "packaged-content-script") {
      throw new Error(`Unsupported build artifact type: ${build.artifactType}`);
    }
  }

  return registrations;
}

export function isMonkeySkillRegistration(id) {
  return typeof id === "string" && id.startsWith(REGISTRATION_PREFIX);
}

function normalizeInstalledRecord(record) {
  const skill = validateSkillManifest(record?.skill);
  const build = validateBuildManifest(record?.build, skill);
  return {
    skill,
    build,
    source: normalizeSource(record.source),
    installedAt: typeof record.installedAt === "string" ? record.installedAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    config: normalizeConfig(record.config, skill.modes)
  };
}

function validateSkillManifest(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid Skill manifest.");
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(value.id)) throw new Error("Invalid Skill id.");
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("Invalid Skill name.");
  if (typeof value.version !== "string" || !value.version.trim()) throw new Error("Invalid Skill version.");
  if (!Array.isArray(value.modes) || value.modes.length === 0) throw new Error("Skill must declare modes.");

  const modes = [...new Set(value.modes.filter(mode => /^[a-z][a-z0-9-]*$/.test(mode)))];
  if (modes.length !== value.modes.length) throw new Error("Invalid Skill modes.");

  return {
    ...structuredClone(value),
    modes
  };
}

function validateBuildManifest(value, skill) {
  if (!value || typeof value !== "object") throw new Error("Invalid build manifest.");
  if (value.skillId !== skill.id || value.skillVersion !== skill.version) {
    throw new Error("Build does not match its Skill manifest.");
  }
  if (value.artifactType !== "packaged-content-script") {
    throw new Error("Only packaged content-script builds are supported in this milestone.");
  }

  const modes = {};
  for (const mode of skill.modes) {
    const artifact = value.modes?.[mode];
    if (!artifact) throw new Error(`Missing build mode: ${mode}`);
    modes[mode] = {
      js: validateArtifactPaths(artifact.js, ".js"),
      css: validateArtifactPaths(artifact.css ?? [], ".css")
    };
  }

  const execution = value.execution ?? {};
  if (!['ISOLATED', 'MAIN'].includes(execution.world)) throw new Error("Invalid execution world.");

  return {
    schemaVersion: value.schemaVersion,
    skillId: value.skillId,
    skillVersion: value.skillVersion,
    artifactType: value.artifactType,
    execution: {
      runAt: execution.runAt ?? "document_idle",
      allFrames: Boolean(execution.allFrames),
      world: execution.world
    },
    modes
  };
}

function validateArtifactPaths(paths, extension) {
  if (!Array.isArray(paths) || paths.length === 0 && extension === ".js") {
    throw new Error(`Build requires at least one ${extension} artifact.`);
  }
  for (const path of paths) {
    if (typeof path !== "string" || !path.startsWith("generated/") || path.includes("..") || !path.endsWith(extension)) {
      throw new Error(`Unsafe generated artifact path: ${path}`);
    }
  }
  return [...paths];
}

function normalizeSource(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    type: typeof source.type === "string" ? source.type : "unknown",
    packagePath: typeof source.packagePath === "string" ? source.packagePath : null,
    skillPath: typeof source.skillPath === "string" ? source.skillPath : null,
    buildPath: typeof source.buildPath === "string" ? source.buildPath : null
  };
}

function makeRegistration({ record, id, mode, matches, excludeMatches = [] }) {
  const artifact = record.build.modes[mode];
  return {
    id,
    matches,
    excludeMatches,
    js: artifact.js,
    css: artifact.css,
    runAt: record.build.execution.runAt,
    persistAcrossSessions: true,
    allFrames: record.build.execution.allFrames,
    world: record.build.execution.world
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
