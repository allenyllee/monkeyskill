import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../scripts/run-real-browser-conformance.mjs", import.meta.url), "utf8");

test("real-browser conformance uses an isolated CDP browser and real pointer input", () => {
  assert.match(script, /--remote-debugging-port=0/);
  assert.match(script, /--user-data-dir=/);
  assert.match(script, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(script, /Input\.dispatchMouseEvent/);
  assert.match(script, /button: "right"/);
  assert.match(script, /button: "left"/);
  assert.match(script, /Page\.bringToFront/);
  assert.match(script, /visibilityState/);
});

test("real-browser conformance self-checks baseline and relaxed reference before blaming a candidate", () => {
  assert.match(script, /candidate-standard/);
  assert.match(script, /candidate-absolute/);
  assert.match(script, /baselineSelectionBlocked/);
  assert.match(script, /referenceSelectionPassed/);
  assert.match(script, /developerInfrastructureReady/);
  assert.match(script, /validateDeveloperConformance/);
});

test("real-browser conformance blocks candidate network outside its local fixture", () => {
  assert.match(script, /Fetch\.enable/);
  assert.match(script, /Fetch\.failRequest/);
  assert.match(script, /BlockedByClient/);
  assert.match(script, /networkViolations/);
});
