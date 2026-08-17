import test from "node:test";
import assert from "node:assert/strict";
import {
  createRetryState,
  evaluateGenerationRetry,
  MAX_GENERATION_ATTEMPTS
} from "../src/lib/generation-policy.js";

const focusFailure = [{ criterion: "preserve-controls", category: "focus-state" }];

function decide(state, attempt, hash, failures = focusFailure) {
  return evaluateGenerationRetry(state, { attempt, hash, failures });
}

test("changed builds get the full attempt budget even when diagnostics repeat", () => {
  let state = createRetryState();
  let decision;
  for (let attempt = 1; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    decision = decide(state, attempt, `hash-${attempt}`);
    assert.equal(decision.retry, true);
    assert.equal(decision.limit, MAX_GENERATION_ATTEMPTS);
    state = decision.state;
  }

  decision = decide(state, MAX_GENERATION_ATTEMPTS, `hash-${MAX_GENERATION_ATTEMPTS}`);
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "attempt-limit");
});

test("changing diagnostics can use the full attempt budget", () => {
  let state = createRetryState();
  let decision;
  const diagnostics = [
    [{ criterion: "paste", category: "event-state" }],
    [{ criterion: "paste", category: "focus-state" }],
    [{ criterion: "context-menu", category: "event-state" }],
    [{ criterion: "selection-visibility", category: "computed-style" }]
  ];
  for (let attempt = 1; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    decision = decide(state, attempt, `hash-${attempt}`, diagnostics[(attempt - 1) % diagnostics.length]);
    assert.equal(decision.retry, true);
    assert.equal(decision.limit, MAX_GENERATION_ATTEMPTS);
    state = decision.state;
  }
  decision = decide(state, MAX_GENERATION_ATTEMPTS, `hash-${MAX_GENERATION_ATTEMPTS}`, diagnostics[0]);
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "attempt-limit");
});

test("a narrowed diagnostic gets the full extended repair budget", () => {
  let state = createRetryState();
  let decision = decide(state, 1, "hash-1", [
    { criterion: "paste", category: "value-state" },
    { criterion: "selection-visibility", category: "computed-style" }
  ]);
  state = decision.state;

  decision = decide(state, 2, "hash-2", [{ criterion: "paste", category: "value-state" }]);
  assert.equal(decision.retry, true);
  assert.equal(decision.limit, MAX_GENERATION_ATTEMPTS);
  state = decision.state;

  for (let attempt = 3; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    decision = decide(state, attempt, `hash-${attempt}`, [{ criterion: "paste", category: "value-state" }]);
    assert.equal(decision.retry, true);
    state = decision.state;
  }

  decision = decide(state, MAX_GENERATION_ATTEMPTS, `hash-${MAX_GENERATION_ATTEMPTS}`, [{ criterion: "paste", category: "value-state" }]);
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "attempt-limit");
});

test("an unchanged build hash stops without wasting another repair", () => {
  let state = createRetryState();
  let decision = decide(state, 1, "same-hash");
  state = decision.state;
  decision = decide(state, 2, "same-hash");
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "unchanged-build");
});
