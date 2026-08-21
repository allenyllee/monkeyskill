import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVerifiedRunnerBootstrapPrompt,
  validateRunnerBootstrapObservation
} from "../src/lib/runner-bootstrap-policy.js";

const validObservation = {
  id: "monkeyskill-runner-bootstrap",
  version: "1.0.6",
  bootstrapUrl: "https://allenyllee.github.io/monkeyskill-store/skills/monkeyskill-runner-bootstrap/1.0.6/bootstrap.json",
  packageHash: "eb4d2956a00f5d2232fe0a06a0f58b050bc831502cafc48e6286db5248701869",
  protocolSchemaVersion: 2,
  protocolProfile: "monkeyskill-normalized-developer-conformance-v1",
  verifiedFileCount: 9,
  verifiedByteCount: 50_000
};

test("Extension accepts only the pinned Runner Bootstrap package and protocol", () => {
  const verified = validateRunnerBootstrapObservation(validObservation);
  assert.equal(verified.version, "1.0.6");
  assert.equal(verified.packageHash, validObservation.packageHash);
  assert.throws(
    () => validateRunnerBootstrapObservation({ ...validObservation, packageHash: "0".repeat(64) }),
    /does not match the installed Extension policy/
  );
  assert.throws(
    () => validateRunnerBootstrapObservation({ ...validObservation, protocolSchemaVersion: 3 }),
    /protocol is incompatible/
  );
  assert.throws(
    () => validateRunnerBootstrapObservation({ ...validObservation, version: "1.0.7" }),
    /not allowed/
  );
});

test("verified Bootstrap prompt is constructed from Extension policy fields", () => {
  const verified = validateRunnerBootstrapObservation(validObservation);
  const prompt = buildVerifiedRunnerBootstrapPrompt(verified, "0.3.2");
  assert.match(prompt, /Extension-verified Bootstrap/);
  assert.match(prompt, new RegExp(validObservation.packageHash));
  assert.match(prompt, /Host protocol schema: 2/);
  assert.match(prompt, /Before reading or following any Bootstrap instruction/);
  assert.match(prompt, /abort unless the result exactly matches/);
});
