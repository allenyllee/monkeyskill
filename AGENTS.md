# MonkeySkill agent testing

When a user asks to simulate the LLM with Codex subagents, the following preflight is mandatory before asking the user to press **Generate**:

1. Finish or stop every previous Builder and Tester task and terminate their outstanding long-poll cells.
2. Restart the clean subagent broker on port `8788`, preserving the token from `.tmp-clean-agent-bootstrap.json`.
3. Run `npm run preflight:agent`. It must complete a disposable Builder and Tester round-trip through the client API and worker queues.
4. Create two fresh clean-room subagents with `fork_turns="none"`: one Builder and one Tester. Never reuse a previous generation worker.
5. Workers must read the token from `.tmp-clean-agent-bootstrap.json`, but poll and complete jobs through the worker API on port `8788`. Port `8787` is the Extension-facing Chat Completions endpoint.
6. Require both workers to prove readiness with a short queue poll before telling the user to press **Generate**.
7. If any preflight step fails, fix it and repeat the full preflight. Do not ask the user to generate while transport or workers are only assumed ready.

