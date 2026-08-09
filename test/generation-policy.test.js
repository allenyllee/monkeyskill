import test from "node:test";
import assert from "node:assert/strict";
import {
  createRetryState,
  evaluateGenerationRetry
} from "../src/lib/generation-policy.js";

const focusFailure = [{ criterion: "preserve-controls", category: "focus-state" }];

function decide(state, attempt, hash, failures = focusFailure) {
  return evaluateGenerationRetry(state, { attempt, hash, failures });
}

test("changed builds get five attempts even when diagnostics repeat", () => {
  let state = createRetryState();
  let decision = decide(state, 1, "hash-1");
  assert.equal(decision.retry, true);
  assert.equal(decision.limit, 5);
  state = decision.state;

  decision = decide(state, 2, "hash-2");
  assert.equal(decision.retry, true);
  state = decision.state;

  decision = decide(state, 3, "hash-3");
  assert.equal(decision.retry, true);
  state = decision.state;

  decision = decide(state, 4, "hash-4");
  assert.equal(decision.retry, true);
  state = decision.state;

  decision = decide(state, 5, "hash-5");
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "attempt-limit");
});

test("changing diagnostics can extend generation to five attempts", () => {
  let state = createRetryState();
  let decision = decide(state, 1, "hash-1");
  state = decision.state;

  decision = decide(state, 2, "hash-2", [{ criterion: "paste", category: "event-state" }]);
  assert.equal(decision.retry, true);
  assert.equal(decision.limit, 5);
  state = decision.state;

  decision = decide(state, 3, "hash-3", [{ criterion: "paste", category: "focus-state" }]);
  assert.equal(decision.retry, true);
  state = decision.state;
  decision = decide(state, 4, "hash-4", [{ criterion: "context-menu", category: "event-state" }]);
  assert.equal(decision.retry, true);
  state = decision.state;
  decision = decide(state, 5, "hash-5", [{ criterion: "selection-visibility", category: "computed-style" }]);
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
  assert.equal(decision.limit, 5);
  state = decision.state;

  decision = decide(state, 3, "hash-3", [{ criterion: "paste", category: "value-state" }]);
  assert.equal(decision.retry, true);
  state = decision.state;

  decision = decide(state, 4, "hash-4", [{ criterion: "paste", category: "value-state" }]);
  assert.equal(decision.retry, true);
  state = decision.state;

  decision = decide(state, 5, "hash-5", [{ criterion: "paste", category: "value-state" }]);
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
