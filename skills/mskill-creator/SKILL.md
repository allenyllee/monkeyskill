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
5. Do not package acceptance tests, fixtures, test scripts, or hidden requirements. At installation time the Builder creates a local public TestSpec and an independent Tester creates a local Independent TestSpec from the same human-readable criteria. Both use the same TestSpec schema and MonkeyTest DSL.
6. Keep responsibility correctly layered: put behavior, domain constraints, browser/event timing assumptions, and required preservation cases in this MSkill; keep only output format, security enforcement, and shared framework semantics in installer-wide prompts.
7. Validate the manifest against [references/mskill-schema.md](references/mskill-schema.md).

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
- Include non-obvious platform conditions that an implementation must survive when they materially define correctness. Initially prefer inputs, timing boundaries, and observable postconditions over a required algorithm.
- When repeated clean-room repairs and real-browser validation demonstrate that a particular implementation constraint is necessary to avoid a recurring platform failure, record it in that MSkill under a clearly labeled validated-implementation section. State why the constraint exists, its safety boundary, and whether an equivalently validated implementation is allowed. Do not force future Builders to rediscover it.
- Do not solve an MSkill-specific failure by adding its event names, DOM APIs, selectors, timing workaround, or implementation technique to a global Builder or Tester prompt. Amend this MSkill when the missing rule belongs only to its behavior.
- Make every mode meaningfully distinct.
- Include failure and safety cases, not only the happy path.
- Include no test files. The Builder and independent Tester generate separate constrained TestSpecs locally from this same human-readable specification during installation: a public Builder TestSpec and a hidden Independent TestSpec in the same DSL.
- Make criteria observable enough that an independent tester can verify them without inventing requirements.
- When timing or a multi-event user gesture matters, describe the complete observable workflow in plain language (for example, paste through the resulting input event or selection after pointer release) without prescribing implementation code.
- Do not claim full compatibility with all websites.
- Do not request network, cookies, history, downloads, or broad browser APIs unless the requested feature cannot exist without them.

## Failure attribution during closed-loop validation

Classify a failure before changing any prompt or specification:

- **Global contract problem:** The failure is independent of the requested browser behavior and can affect arbitrary MSkills—for example malformed output shape, unsafe capabilities, hidden-test leakage, routing/completion protocol, DSL schema, or a shared workflow primitive that does not match real browser semantics. Fix the installer policy, validator, broker, or shared framework and add a generic regression test.
- **MSkill specification problem:** The failure concerns behavior, events, page interference, timing, preservation requirements, or compatibility unique to this MSkill. Clarify its `SKILL.md` with the missing observable condition and criterion coverage. If repeated closed loops establish a necessary implementation constraint, preserve that constraint in this MSkill rather than promoting it into a global prompt.
- **Candidate implementation problem:** The MSkill already states the condition and the shared framework models it correctly, but one generated candidate fails. Let the Builder repair that candidate; do not change global policy or the portable MSkill solely to encode the successful implementation.

Escalate a lesson to a global prompt or framework only after demonstrating that it is behavior-agnostic or that the shared contract itself is wrong. A fix that mentions only one MSkill's event family or DOM workaround is presumed MSkill-specific until proven otherwise, but may and should be retained inside that MSkill when repeated validation proves it necessary.
