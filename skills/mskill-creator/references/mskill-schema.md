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

Acceptance tests use schema version 2 and contain only declarative references to Extension-approved scenarios:

```json
{
  "schemaVersion": 2,
  "tests": [
    {
      "id": "stable-test-id",
      "mode": "standard",
      "criterion": "native-context-menu",
      "scenario": "inline-contextmenu-block"
    }
  ]
}
```

`criterion` must match a visible `[criterion:native-context-menu]` marker in `SKILL.md`. Test objects may contain only `id`, `mode`, `criterion`, and `scenario`; capability-denial checks may instead contain `id`, `type`, `capability`, and `criterion`. A capability-denial criterion must be named `no-<capability>` and the capability must appear in `forbiddenCapabilities`.

The MSkill package must not contain executable test code. The Extension owns the fixed scenario implementations and executes them in an isolated sandbox. The generator never receives `acceptance.json`, scenario names, assertion messages, fixture data, or runtime errors. A repair attempt may receive only criterion IDs that were already visible in `SKILL.md`.

## Approved scenarios

Use only these fixed scenario names:

- `inline-contextmenu-block`
- `input-contextmenu-listener`
- `paste-event-blocker`
- `image-contextmenu-listener`
- `contextmenu-alert-blocker`
- `media-pointer-events`
- `overlay-contextmenu-listener`
- `image-overlay-pointer-events`
- `selectstart-blocker`
- `selection-survives-release`
- `keyboard-copy-blocker`
- `visible-selection`
- `input-overlay-pointer-events`
- `paste-rollback`
- `canvas-overlay-pointer-events`
- `css-background-contextmenu`
- `ordinary-controls-preserved`

Every criterion in `SKILL.md` must be referenced by at least one test. If none represents the requested behavior, do not invent a scenario or add test code. Report that the MSkill is not installable until MonkeySkill itself adds and reviews a reusable scenario.
