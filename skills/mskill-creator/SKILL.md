---
name: mskill-creator
description: Create or revise portable, human-readable MonkeySkill specifications from a requested browser behavior, an extension feature description, or a legacy extension analysis. Use when an agent must define goals, modes, capabilities, restrictions, and observable criterion markers without writing runtime code or tests; independent tests are generated locally at installation time.
---

# MSkill Creator

Create a behavior-level source package that another LLM can independently compile into an installable browser script.

## Workflow

1. Describe observable user behavior, supported pages, modes, and known limits.
2. Declare only the capabilities required by the behavior.
3. Explicitly forbid sensitive capabilities that are unnecessary.
4. Give every human-readable success criterion a stable `[criterion:id]` marker in `SKILL.md`.
5. Do not create acceptance tests, fixtures, test scripts, or hidden requirements. MonkeySkill generates tests independently at installation time.
6. Validate the manifest against [references/mskill-schema.md](references/mskill-schema.md).

## Output

Create only:

```text
skills/<skill-id>/
├── SKILL.md
└── skill.json
```

Use lowercase hyphenated IDs. Treat the human-readable specification as the canonical source; generated TestSpecs and runtime JS/CSS are local installation artifacts and must be reproducible from this package.

## Quality bar

- Specify outcomes rather than implementation details.
- Make every mode meaningfully distinct.
- Include failure and safety cases, not only the happy path.
- Include no test files. An independent Tester LLM generates a constrained TestSpec locally from this same human-readable specification during installation.
- Make criteria observable enough that an independent tester can verify them without inventing requirements.
- Do not claim full compatibility with all websites.
- Do not request network, cookies, history, downloads, or broad browser APIs unless the requested feature cannot exist without them.
