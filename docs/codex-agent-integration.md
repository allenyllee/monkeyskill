# ChatGPT Agent integration POC

MonkeySkill 0.3.6 adds an experimental Extension-to-Agent path through the local Codex App
Server. It proves that a user who already has Codex can authorize MonkeySkill with the user's
ChatGPT account instead of placing an API key inside the Extension. It does not yet migrate the
production MSkill generation and validation roles away from BYOK.

## Boundary

- The Extension connects only to loopback `ws://` URLs. Remote hosts and URL credentials fail
  closed.
- Codex App Server owns ChatGPT authentication and cached credentials. The Extension receives an
  authorization URL and redacted account fields, not cookies or tokens.
- Login uses the hosted ChatGPT success page and the local callback owned by App Server.
- The smoke test uses `approvalPolicy: never`, a read-only sandbox, a prompt that explicitly
  forbids tools, and an exact expected response.
- The smoke-test thread is archived after success or failure. It is never reused as a Builder,
  Tester, or Attacker.
- Existing BYOK generation remains unchanged until separate Agent roles, repair routing,
  interruption recovery, and pre-install replay are independently demonstrated.

Official protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server) and
[Authentication](https://learn.chatgpt.com/docs/auth).

## Flow

```mermaid
flowchart TD
    U[User opens Extension options] --> L[Local Codex App Server]
    L --> H[initialize / initialized]
    H --> A[account/read]
    A -->|ChatGPT account present| S[Test Agent]
    A -->|sign-in required| B[account/login/start]
    B --> C[Extension opens official authUrl]
    C --> D[ChatGPT authenticates to App Server callback]
    D --> A
    S --> T[thread/start: read-only + never approve]
    T --> R[turn/start: exact no-tool smoke contract]
    R --> E[item/completed + turn/completed]
    E --> G{Exact reply?}
    G -->|yes| P[Show Agent verified]
    G -->|no or protocol error| F[Fail closed]
    P --> X[thread/archive]
    F --> X
```

## Operation

1. Start `codex app-server --listen ws://127.0.0.1:4500` outside the browser.
2. Reload MonkeySkill 0.3.6 and open its options page.
3. Under **ChatGPT Agent**, leave the default loopback URL and select **Check connection**.
4. If sign-in is required, select **Sign in with ChatGPT**, complete the official browser flow,
   and check the connection again.
5. Select **Test Agent**. A pass requires the exact final answer
   `MONKEYSKILL_AGENT_OK`; connection alone is not sufficient.

## Evidence

The module test replays the full wire sequence with a deterministic fake App Server and verifies
loopback URL enforcement plus account-field redaction. A real Codex CLI 0.149.0 run additionally
completed the handshake, read a ChatGPT subscription account, ran the isolated turn, received the
exact final answer, and archived the generated thread.

The real run also exposed two version-sensitive wire details now covered by regression tests:
legacy `thread/start.sandbox` uses `read-only`, while current `turn/start.sandboxPolicy` accepts
`{ "type": "readOnly" }` without the older `access` member. This is why the POC pins its tested
message shapes instead of assuming documentation examples and installed CLI releases are always
identical.

## Next integration gate

Before this path can replace BYOK generation, the orchestrator must prove four isolated Agent
threads (Tester A, Attacker, Tester B, and Builder), sticky repair routing, constrained evidence
projection, cancellation and service-worker recovery, and the existing pre-install independent
replay. Authentication success or one smoke-test turn does not satisfy that gate.
