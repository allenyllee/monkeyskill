# MSkill source schema

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
  "entrypoint": "SKILL.md"
}
```

Do not add `tests`, test paths, fixtures, scripts, prompts, or executable resources. The portable MSkill source contains only `skill.json` and the human-readable entrypoint.

Give every observable outcome a stable marker in `SKILL.md`:

```markdown
- [criterion:native-context-menu] A real user right-click opens the native context menu.
- [criterion:no-network] The implementation makes no network requests.
```

Use lowercase criterion IDs. A capability-denial criterion must be named `no-<capability>` and that capability must appear in `forbiddenCapabilities`. During installation, the Builder converts these criteria into public self-tests and a separate Tester LLM independently creates a hidden TestSpec. Neither local TestSpec is part of the shared MSkill.

Describe complete user-visible workflows when correctness depends on browser event order. State the outcome after the real gesture completes, such as the value remaining after paste emits its input event or the range remaining selected after pointer release. Keep this human-readable and implementation-independent.

Record non-obvious environment or platform variants in `SKILL.md` when they are part of the behavior contract—for example a relevant event field being absent, a page action occurring in a later checkpoint, or an ordinary control that must remain usable. Begin with the variant and required observable result rather than prematurely choosing an algorithm.

If repeated clean-room repair cycles plus real-browser validation prove that a concrete mechanism
or ordering constraint is necessary, add a concise `Validated implementation constraints`
section to that MSkill. Include the failure it prevents, the required checkpoint or mechanism,
the safety scope, and whether equivalent implementations are permitted after full revalidation.
This is durable domain knowledge, not portable installer policy.

Do not move MSkill-specific event families, DOM APIs, timing workarounds, selectors, or repair algorithms into an installer-wide Builder/Tester prompt. Global prompts own portable output shape, security, validation, and shared framework contracts. The MSkill owns its domain behavior and platform conditions; a generated candidate owns its chosen implementation.
