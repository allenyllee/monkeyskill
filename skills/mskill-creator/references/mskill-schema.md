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

Use lowercase criterion IDs. A capability-denial criterion must be named `no-<capability>` and that capability must appear in `forbiddenCapabilities`. The locally configured Tester LLM independently converts these visible criteria into a constrained TestSpec during installation; that TestSpec is not part of the shared MSkill.

Describe complete user-visible workflows when correctness depends on browser event order. State the outcome after the real gesture completes, such as the value remaining after paste emits its input event or the range remaining selected after pointer release. Keep this human-readable and implementation-independent.
