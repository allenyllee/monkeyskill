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
  "entrypoint": "SKILL.md",
  "tests": "tests/acceptance.json"
}
```

Acceptance tests use a JSON object with `schemaVersion` and a `tests` array. Each test needs a stable ID, a machine-readable type, inputs or targets, and an expected result. Keep targets generic or provide a dedicated local fixture when a real site is unstable.
