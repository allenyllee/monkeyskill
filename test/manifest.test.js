import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("manifest references existing extension entrypoints", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, undefined);
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));

  await Promise.all([
    access(join(root, manifest.background.service_worker)),
    access(join(root, manifest.action.default_popup)),
    access(join(root, manifest.options_page))
  ]);
});

test("the packaged skill declares no network capability", async () => {
  const skill = JSON.parse(await readFile(
    join(root, "src", "skills", "restore-right-click", "skill.json"),
    "utf8"
  ));

  assert.ok(skill.capabilities.includes("dom"));
  assert.ok(skill.forbiddenCapabilities.includes("network"));
  assert.ok(!skill.capabilities.includes("network"));
});
