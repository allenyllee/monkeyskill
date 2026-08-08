import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES,
  buildRegistrations,
  installSkillPackage,
  normalizeConfig,
  sitePatternFromUrl,
  uninstallSkillPackage
} from "../src/lib/skill-store.js";

const skill = {
  schemaVersion: 1,
  id: "restore-right-click",
  name: "Restore right click & copy",
  version: "1.0.0",
  modes: ["standard", "absolute"]
};

const build = {
  schemaVersion: 1,
  skillId: "restore-right-click",
  skillVersion: "1.0.0",
  artifactType: "packaged-content-script",
  execution: { runAt: "document_start", allFrames: true, world: "MAIN" },
  modes: {
    standard: {
      js: ["generated/restore-right-click/1.0.0/standard.js"],
      css: ["generated/restore-right-click/1.0.0/standard.css"]
    },
    absolute: {
      js: ["generated/restore-right-click/1.0.0/absolute.js"],
      css: ["generated/restore-right-click/1.0.0/absolute.css"]
    }
  }
};

test("sitePatternFromUrl creates an exact host match pattern", () => {
  assert.equal(sitePatternFromUrl("https://www.example.com/a?b=1"), "https://www.example.com/*");
});

test("sitePatternFromUrl rejects protected protocols", () => {
  assert.throws(() => sitePatternFromUrl("chrome://extensions"));
});

test("install and uninstall use the same package store", () => {
  const installed = installSkillPackage({}, {
    skill,
    build,
    source: { type: "bundled", skillPath: "skills/restore-right-click/skill.json" }
  });
  assert.equal(installed[skill.id].skill.name, skill.name);
  assert.equal(installed[skill.id].config.globalMode, MODES.OFF);
  assert.deepEqual(uninstallSkillPackage(installed, skill.id), {});
});

test("normalizeConfig drops invalid modes and patterns", () => {
  assert.deepEqual(normalizeConfig({
    globalMode: "danger",
    siteOverrides: {
      "https://example.com/*": MODES.ABSOLUTE,
      "chrome://settings/*": MODES.STANDARD,
      "https://bad.example/*": "danger"
    }
  }), {
    globalMode: MODES.OFF,
    siteOverrides: { "https://example.com/*": MODES.ABSOLUTE }
  });
});

test("buildRegistrations reads generated artifacts from the installed package", () => {
  const installed = installSkillPackage({}, { skill, build, source: { type: "bundled" } });
  installed[skill.id].config = {
    globalMode: MODES.STANDARD,
    siteOverrides: {
      "https://example.com/*": MODES.ABSOLUTE,
      "https://disabled.example/*": MODES.OFF
    }
  };

  const registrations = buildRegistrations(installed);
  assert.equal(registrations.length, 2);
  const global = registrations.find(item => item.id.endsWith("global"));
  const siteRegistration = registrations.find(item => item.matches.includes("https://example.com/*"));
  assert.deepEqual(global.excludeMatches.sort(), [
    "https://disabled.example/*",
    "https://example.com/*"
  ]);
  assert.deepEqual(siteRegistration.js, ["generated/restore-right-click/1.0.0/absolute.js"]);
});
