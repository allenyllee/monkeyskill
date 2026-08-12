# MonkeySkill agent testing

For an end-to-end generation, installation, or regression request, read and follow
[`docs/closed-loop-validation.md`](docs/closed-loop-validation.md). A broker completion or
Runner pass alone is not a closed-loop result: the generated Skill must be installed and
exercised on the real published demo origin when the user has authorized those actions.

When a user asks to simulate the LLM with Codex subagents, the following preflight is mandatory before asking the user to press **Generate**:

1. Finish or stop every previous Builder and Tester task and terminate their outstanding long-poll cells.
2. Restart the clean subagent broker on port `8788`, preserving the token from `.tmp-clean-agent-bootstrap.json`.
3. Run `npm run preflight:agent`. It must complete a disposable Builder and Tester round-trip through the client API and worker queues.
4. Create two fresh clean-room subagents with `fork_turns="none"`: one Builder and one Tester. Never reuse a previous generation worker.
5. Workers must read the token from `.tmp-clean-agent-bootstrap.json`, but poll and complete jobs through the worker API on port `8788`. Port `8787` is the Extension-facing Chat Completions endpoint.
6. Require both workers to prove readiness with a short queue poll before telling the user to press **Generate**.
7. If any preflight step fails, fix it and repeat the full preflight. Do not ask the user to generate while transport or workers are only assumed ready.

Additional non-negotiable rules:

- Treat port `8787` as Extension-facing and port `8788` as the clean-room worker API. Never silently switch a worker back to a stale bootstrap endpoint.
- Keep `.tmp-clean-agent-bootstrap.json` available for the entire simulation. Do not delete it while workers or the Extension may still need it.
- Preserve and parse the complete raw job response before field projection. The completion UUID is `job.id`, not `jobId`; validate it before POST and never infer it from a routing key or session suffix. Losing it invalidates that generation because the active lease cannot be queried back.
- A Builder or Tester completion is accepted only after `POST /agent/jobs/{job.id}/complete` returns success. A `404` lease/lifecycle response is not completion.
- On Windows, submit completion from a validated UTF-8 no-BOM JSON file with `curl.exe --data-binary @file`; do not use PowerShell stdin/pipelines. Capture an explicit HTTP 200 and response body before reporting success.
- Builder and Tester must remain pinned to their first routing key. Repairs may not be handled by a worker from another generation.
- Do not call a run stable solely because schema checks, public self-tests, or hidden tests passed. Perform the real-browser checks in the closed-loop runbook and report inconclusive visual checks honestly.
- Any acceptance criterion about rendered pixels, selection highlighting, overlays, visibility, contrast, or native browser UI requires a screenshot after the real interaction on the registered origin. A DOM assertion alone cannot promote that criterion from inconclusive to passed.
