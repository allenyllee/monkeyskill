# MonkeySkill agent testing

For an end-to-end generation, installation, or regression request, read and follow
[`docs/closed-loop-validation.md`](docs/closed-loop-validation.md). A broker completion or
Runner pass alone is not a closed-loop result: the generated Skill must be installed and
exercised on the real published demo origin when the user has authorized those actions.

For MSkill creation, criterion evolution, safety-boundary changes, or methodology work, also
read [`docs/evidence-driven-generative-development.md`](docs/evidence-driven-generative-development.md).
Keep generated code replaceable, grow criteria from reproducible evidence, and classify failures
before changing global policy or an MSkill contract.

When a user asks to simulate the LLM with Codex subagents, the following preflight is mandatory before asking the user to press **Generate**:

1. Finish or stop every previous Attacker, Builder, and Tester task and terminate their outstanding long-poll cells.
2. Restart the clean subagent broker on port `8788`, preserving the token from `.tmp-clean-agent-bootstrap.json`.
   Start the checked-in `npm run serve:agent-forwarder` on port `8787`; do not depend on a temporary forwarder script.
3. Run `npm run preflight:agent`. It must complete disposable Attacker, Builder, and Tester round-trips through the client API and worker queues.
4. Create fresh clean-room workers with `fork_turns="none"` for every role reached by the gate: Tester A first; only after it allows, Attacker and a distinct Tester B; only after Tester B rejects, Builder. Never reuse a previous generation worker.
5. Workers must read the token from `.tmp-clean-agent-bootstrap.json`, but poll and complete jobs through the worker API on port `8788`. Port `8787` is the Extension-facing Chat Completions endpoint.
6. Require every worker needed for the next gate stage to prove readiness with a short queue poll before advancing that stage.
7. If any preflight step fails, fix it and repeat the full preflight. Do not ask the user to generate while transport or workers are only assumed ready.

Additional non-negotiable rules:

- Treat port `8787` as Extension-facing and port `8788` as the clean-room worker API. Never silently switch a worker back to a stale bootstrap endpoint.
- Keep `.tmp-clean-agent-bootstrap.json` available for the entire simulation. Do not delete it while workers or the Extension may still need it.
- Preserve and parse the complete raw job response before field projection. The completion UUID is `job.id`, not `jobId`; validate it before POST and never infer it from a routing key or session suffix. Losing it invalidates that generation because the active lease cannot be queried back.
- A Builder or Tester completion is accepted only after `POST /agent/jobs/{job.id}/complete` returns success. A `404` lease/lifecycle response is not completion.
- On Windows, submit completion from a validated UTF-8 no-BOM JSON file with `curl.exe --data-binary @file`; do not use PowerShell stdin/pipelines. Capture an explicit HTTP 200 and response body before reporting success.
- Attacker, Builder, and each Tester must remain pinned to their first routing key. Repairs may not be handled by a worker from another generation.
- Do not call a run stable solely because schema checks, the public Builder TestSpec, or the Independent TestSpec passed. Perform the real-browser checks in the closed-loop runbook and report inconclusive visual checks honestly.
- Any acceptance criterion about rendered pixels, selection highlighting, overlays, visibility, contrast, or native browser UI requires a screenshot after the real interaction on the registered origin. A DOM assertion alone cannot promote that criterion from inconclusive to passed.
- For local real-browser A/B checks, switch an installed MSkill mode through the local Store bridge described in the runbook, reload the target page after each switch, verify the active behavior instead of trusting a transient notice alone, and restore the recorded pre-test mode when finished.
- Keep application development and infrastructure maintenance as separate governed loops. During
  MSkill development, a Runner/Host/broker/provider failure does not authorize modifying or activating
  infrastructure in the application run. Preserve the application checkpoint, produce a minimal
  reproducer and a generic proposed repair in isolation, and report it for infrastructure-maintainer
  review. Only a distinct maintainer workflow may review, independently meta-test, version, and publish
  that repair. Ordinary user installation uses a published infrastructure version, fails closed on
  infrastructure errors without consuming Builder attempts, and never rebuilds Runner/Host in the
  background. In future conversational simulations, model these as distinct roles and phases.

## Commit policy

- After completing and validating requested file changes, automatically create a focused Git commit in each modified repository without waiting for a separate commit request.
- Preserve unrelated pre-existing changes and never include them merely to make the working tree clean.
- Push each validated focused commit to its current tracked remote branch automatically. If the push is rejected, preserve local work, diagnose safely, and report or resolve the divergence without destructive Git operations.
- Report the resulting commit hash, message, and pushed branch.
