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

Acceptance tests use a JSON object with `schemaVersion`, an executable `runner`, and a `tests` array:

```json
{
  "schemaVersion": 1,
  "runner": "tests/browser.js",
  "tests": [
    { "id": "stable-test-id", "mode": "standard" }
  ]
}
```

Every browser-test ID must have a matching function in the fixed runner source. The runner executes the generated build in an isolated sandbox and must assert observable outcomes. Capability-denial checks may remain declarative because the installer performs those checks itself. Keep fixtures local and deterministic; do not depend on a real website.
