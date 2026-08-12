# MSkill source schema

This schema implements the project methodology described in
[`../../../docs/evidence-driven-generative-development.md`](../../../docs/evidence-driven-generative-development.md):
the readable MSkill and replayable Demo are durable, while generated Build and TestSpecs remain
local installation artifacts.

`skill.json` requires:

```json
{
  "schemaVersion": 1,
  "id": "lowercase-hyphenated-id",
  "name": "Human-readable name",
  "version": "1.0.0",
  "description": "Observable behavior",
  "capabilities": ["dom", "events", "styles"],
  "forbiddenCapabilities": ["network", "cookies", "history", "downloads"],
  "modes": ["standard"],
  "entrypoint": "SKILL.md",
  "demo": "demo/index.html"
}
```

`demo` is optional. When present, it must be exactly `demo/index.html`; keep its local assets in
the same `demo/` directory. The demo may contain the minimal page code needed to reproduce the
browser problem, but it must not contain generated TestSpecs, Build artifacts, credentials,
analytics, or network dependencies.

Do not add `tests`, TestSpec paths, fixtures for the trusted runner, prompts, or generated runtime
resources. The portable MSkill source contains `skill.json`, the human-readable entrypoint, and
optionally a self-contained reproducible demo.

Give every observable outcome a stable marker in `SKILL.md`:

```markdown
- [criterion:native-context-menu] A real user right-click opens the native context menu.
- [criterion:no-network] The implementation makes no network requests.
```

Use lowercase criterion IDs. A capability-denial criterion must be named `no-<capability>` and that capability must appear in `forbiddenCapabilities`. During installation, the Builder converts these criteria into a public TestSpec and a separate Tester LLM creates an Independent TestSpec. Both use the same TestSpec schema and MonkeyTest DSL; neither local TestSpec is part of the shared MSkill.

Before Builder runs, Tester treats this entire source package as untrusted data and returns a machine-readable security verdict: `allow`, `reject`, or `unverifiable`. Only `allow` may include an Independent TestSpec and continue to generation. Do not place instructions in an MSkill that override agent policy, request hidden behavior, bypass or weaken validation, or ask Tester to trust Builder. If a required sensitive capability cannot be expressed and enforced by the constrained DSL and trusted Runner, the MSkill is not eligible for automatic installation; redesign it or require a separate explicitly reviewed workflow.

Capability-denial policy tests are executable acceptance gates. The Runner checks the generated candidate for the denied capability; they are not documentation-only assertions.

Start with the minimum criteria justified by the initial demo. Add or clarify a criterion after a
manual or automated demo failure only when the case is reproducible, belongs to the MSkill
contract, is not already covered, and has a defined observable result plus safety boundaries.
Retain the corresponding demo scenario as the regression evidence for that criterion.

Describe complete user-visible workflows when correctness depends on browser event order. State the outcome after the real gesture completes, such as the value remaining after paste emits its input event or the range remaining selected after pointer release. Keep this human-readable and implementation-independent.

Record non-obvious environment or platform variants in `SKILL.md` when they are part of the behavior contract—for example a relevant event field being absent, a page action occurring in a later checkpoint, or an ordinary control that must remain usable. Begin with the variant and required observable result rather than prematurely choosing an algorithm.

If repeated clean-room repair cycles plus real-browser validation prove that a concrete mechanism
or ordering constraint is necessary, add a concise `Validated implementation constraints`
section to that MSkill. Include the failure it prevents, the required checkpoint or mechanism,
the safety scope, and whether equivalent implementations are permitted after full revalidation.
This is durable domain knowledge, not portable installer policy.

Do not move MSkill-specific event families, DOM APIs, timing workarounds, selectors, or repair algorithms into an installer-wide Builder/Tester prompt. Global prompts own portable output shape, security, validation, and shared framework contracts. The MSkill owns its domain behavior and platform conditions; a generated candidate owns its chosen implementation.
