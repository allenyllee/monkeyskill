export const DEFAULT_GENERATION_ATTEMPTS = 3;
export const MAX_GENERATION_ATTEMPTS = 5;

export function createRetryState() {
  return {
    previousHash: null,
    previousFailureSignature: null,
    unchangedDiagnosticRounds: 0,
    sawDiagnosticChange: false
  };
}

export function evaluateGenerationRetry(state, { attempt, hash, failures }) {
  const failureSignature = signatureForFailures(failures);
  let unchangedDiagnosticRounds = state.unchangedDiagnosticRounds;
  let sawDiagnosticChange = state.sawDiagnosticChange;

  if (state.previousFailureSignature) {
    if (state.previousFailureSignature === failureSignature) unchangedDiagnosticRounds += 1;
    else {
      unchangedDiagnosticRounds = 0;
      sawDiagnosticChange = true;
    }
  }

  const nextState = {
    previousHash: hash,
    previousFailureSignature: failureSignature,
    unchangedDiagnosticRounds,
    sawDiagnosticChange
  };

  if (state.previousHash && state.previousHash === hash) {
    return { retry: false, reason: "unchanged-build", limit: attempt, state: nextState };
  }
  if (unchangedDiagnosticRounds >= 2) {
    return { retry: false, reason: "repeated-diagnostics", limit: attempt, state: nextState };
  }

  const limit = sawDiagnosticChange ? MAX_GENERATION_ATTEMPTS : DEFAULT_GENERATION_ATTEMPTS;
  if (attempt >= limit) return { retry: false, reason: "attempt-limit", limit, state: nextState };
  return { retry: true, reason: "retry", limit, state: nextState };
}

export function signatureForFailures(failures) {
  return failures
    .map(failure => `${failure.criterion}:${failure.category}`)
    .sort()
    .join("|");
}
