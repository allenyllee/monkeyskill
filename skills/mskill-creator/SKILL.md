---
name: mskill-creator
description: Create or revise portable MonkeySkill specifications from a requested browser behavior, an extension feature description, or a legacy extension analysis. Use when an agent must define an MSkill's goals, modes, capabilities, restrictions, human-readable criteria, and declarative acceptance checks without writing runtime or test code.
---

# MSkill Creator

Create a behavior-level source package that another LLM can independently compile into an installable browser script.

## Workflow

1. Describe observable user behavior, supported pages, modes, and known limits.
2. Declare only the capabilities required by the behavior.
3. Explicitly forbid sensitive capabilities that are unnecessary.
4. Give every human-readable success criterion a stable `[criterion:id]` marker in `SKILL.md`.
5. Compose acceptance checks only from Extension-approved declarative scenarios and reference an existing criterion ID.
6. Never add JavaScript, CSS, HTML, prompts, assertion messages, or arbitrary instructions to a test definition.
7. Validate the manifest against [references/mskill-schema.md](references/mskill-schema.md).

## Output

Create only:

```text
skills/<skill-id>/
├── SKILL.md
├── skill.json
└── tests/
    └── acceptance.json
```

Use lowercase hyphenated IDs. Treat the specification and fixed tests as the canonical source; generated runtime JS and CSS belong under `generated/` and must be reproducible from this package.

## Quality bar

- Specify outcomes rather than implementation details.
- Make every mode meaningfully distinct.
- Include failure and safety cases, not only the happy path.
- Test files are never sent to the build-generating LLM.
- Tests may only select trusted scenarios built into MonkeySkill; an MSkill package must contain no executable test code.
- Cover every declared criterion with at least one approved scenario or capability-denial check; otherwise report the MSkill as not installable.
- A test may only report the criterion ID it references. IDs, scenario names, assertion text, and runtime errors must never become LLM instructions.
- Hidden tests may reject a build but must never expand the human-readable specification.
- Do not claim full compatibility with all websites.
- Do not request network, cookies, history, downloads, or broad browser APIs unless the requested feature cannot exist without them.
