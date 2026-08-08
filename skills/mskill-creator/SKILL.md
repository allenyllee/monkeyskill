---
name: mskill-creator
description: Create or revise portable MonkeySkill specifications from a requested browser behavior, an extension feature description, or a legacy extension analysis. Use when an agent must define an MSkill's goals, modes, capabilities, restrictions, and executable acceptance tests without writing its generated runtime implementation.
---

# MSkill Creator

Create a behavior-level source package that another LLM can independently compile into an installable browser script.

## Workflow

1. Describe observable user behavior, supported pages, modes, and known limits.
2. Declare only the capabilities required by the behavior.
3. Explicitly forbid sensitive capabilities that are unnecessary.
4. Write fixed executable acceptance tests against observable DOM, event, style, or permission outcomes.
5. Keep generated runtime code out of the specification directory; test-runner code belongs under `tests/`.
6. Validate the manifest against [references/mskill-schema.md](references/mskill-schema.md).

## Output

Create only:

```text
skills/<skill-id>/
├── SKILL.md
├── skill.json
└── tests/
    ├── acceptance.json
    └── browser.js
```

Use lowercase hyphenated IDs. Treat the specification and fixed tests as the canonical source; generated runtime JS and CSS belong under `generated/` and must be reproducible from this package.

## Quality bar

- Specify outcomes rather than implementation details.
- Make every mode meaningfully distinct.
- Include failure and safety cases, not only the happy path.
- Every declared browser test must have fixed executable test code that the build-generating LLM cannot replace.
- Do not claim full compatibility with all websites.
- Do not request network, cookies, history, downloads, or broad browser APIs unless the requested feature cannot exist without them.
