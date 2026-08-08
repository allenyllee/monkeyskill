import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES,
  buildRegistrations,
  normalizeSettings,
  sitePatternFromUrl
} from "../src/lib/settings.js";

test("sitePatternFromUrl creates an exact host match pattern", () => {
  assert.equal(
    sitePatternFromUrl("https://www.example.com/a?b=1"),
    "https://www.example.com/*"
  );
});

test("sitePatternFromUrl rejects protected protocols", () => {
  assert.throws(() => sitePatternFromUrl("chrome://extensions"));
});

test("normalizeSettings drops invalid modes and patterns", () => {
  assert.deepEqual(normalizeSettings({
    globalMode: "danger",
    siteOverrides: {
      "https://example.com/*": MODES.ABSOLUTE,
      "chrome://settings/*": MODES.STANDARD,
      "https://bad.example/*": "danger"
    }
  }), {
    globalMode: MODES.OFF,
    siteOverrides: {
      "https://example.com/*": MODES.ABSOLUTE
    }
  });
});

test("buildRegistrations excludes overrides from the global script", () => {
  const registrations = buildRegistrations({
    globalMode: MODES.STANDARD,
    siteOverrides: {
      "https://example.com/*": MODES.ABSOLUTE,
      "https://disabled.example/*": MODES.OFF
    }
  });

  assert.equal(registrations.length, 2);
  const global = registrations.find(item => item.id.endsWith("global"));
  const site = registrations.find(item => item.matches.includes("https://example.com/*"));
  assert.deepEqual(global.excludeMatches.sort(), [
    "https://disabled.example/*",
    "https://example.com/*"
  ]);
  assert.deepEqual(site.js, ["src/skills/restore-right-click/absolute.js"]);
  assert.equal(site.world, "MAIN");
});

