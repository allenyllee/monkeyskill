# Evidence-driven generative development

MonkeySkill explores a software-development method in which the durable source is a
human-readable behavioral contract, while executable code is generated, challenged, discarded,
and regenerated as needed. The goal is repeatable conformance without forcing every generation
to use the same implementation.

> Evolve the specification from evidence, keep implementations replaceable, make validation
> replayable, and never relax the safety boundary.

## Durable artifacts

- **Demo:** a minimal, self-contained real-browser reproduction and visible expected outcome.
- **MSkill:** the human-readable behavior, capability, safety, preservation, and compatibility
  contract in `SKILL.md` plus its declarative manifest.
- **Criteria:** stable `[criterion:id]` outcomes promoted conservatively from reproduced evidence.
- **Validated implementation constraints:** MSkill-specific mechanisms retained only after
  repeated clean-room repair and browser evidence show they are necessary.
- **TestSpec DSL and trusted Runner:** the bounded, non-executable validation language and its
  enforcing environment.
- **Closed-loop evidence:** Runner results, browser observations, screenshots, hashes, and
  reproducible failure scenarios.

Generated JavaScript and CSS are disposable derivatives. A different Build is acceptable when
it passes the same functional, preservation, and safety contract.

## Three layers of constraint

1. **Behavioral contract:** observable outcomes and forbidden effects. This is strict.
2. **Validated implementation constraints:** proven checkpoints or known-invalid approaches.
   Equivalent approaches remain allowed after full revalidation.
3. **Free implementation detail:** algorithms, data structures, naming, and code organization
   remain Builder choices.

This separation provides stability without turning one successful implementation into a global
recipe that misleads future MSkills.

## Development loop

1. Reproduce a real user problem in the smallest practical Demo.
2. Confirm the blocked baseline and define the visible expected result.
3. Write only the smallest useful criteria justified by current evidence.
4. Declare minimum capabilities and explicit denials for unnecessary sensitive capabilities.
5. Have Independent Tester treat the MSkill as untrusted input and return:
   - `allow` with a complete Independent TestSpec;
   - `reject` for malicious, concealed, validation-bypassing, undeclared, or unjustifiably
     sensitive behavior;
   - `unverifiable` when the DSL and Runner cannot enforce an essential safety property.
6. Contact Builder only after `allow`. Builder produces a candidate and public Builder TestSpec
   in the same constrained DSL.
7. Run the Builder TestSpec, repair with detailed public diagnostics, then run the hidden
   Independent TestSpec and repair with constrained diagnostics that do not reveal the test.
8. Install a validated candidate and exercise the real Demo through actual browser interactions.
   Capture screenshots after interaction for pixel-dependent criteria.
9. Classify every failure as global framework/security, MSkill specification, or disposable
   candidate implementation before changing anything.
10. Preserve a reproducible Demo failure and add or clarify a criterion only when it proves a
    durable product requirement not already covered. Regenerate with fresh agent contexts.
11. Require the configured consecutive clean-run threshold before claiming generation stability.

## Independent agents and the Demo

Builder and Independent Tester receive the same readable MSkill but run in separate
conversations. Tester never sees the candidate or Builder TestSpec. This reduces overfitting, but
both agents can share a blind spot caused by an incomplete specification. The Demo is therefore
a third validation surface and the source of evidence for evolving the contract.

Agreement between both TestSpecs is necessary, not sufficient. Stability requires successful
replay in the registered browser environment, including visual evidence where the DSL cannot
prove rendered pixels.

## Security model

Builder may generate arbitrary JavaScript, so approval cannot depend on Builder intent:

- the MSkill remains human-readable and reviewable;
- Tester treats it as untrusted data and cannot be instructed by it to weaken validation;
- `reject` and `unverifiable` stop generation before Builder runs;
- TestSpec accepts only a bounded DSL without JavaScript, selectors, URLs, or executable
  expressions;
- capability-denial policy tests inspect the candidate instead of passing by declaration;
- the trusted Runner executes candidates in a sandbox with capability controls;
- static scanning, schemas, Chrome parse checks, approval, and final independent replay add gates.

The DSL guarantees only what the Runner can enforce or observe. A sensitive behavior outside
that boundary is `unverifiable`, not implicitly safe. Extending the boundary requires a generic
Runner capability and regression tests, not an MSkill instruction asking Tester to trust code.

## Evidence-driven criterion evolution

Do not begin with a speculative catalogue of edge cases. Promote a Demo failure into a criterion
only when it is reproducible, belongs to the MSkill, is not already covered, has an observable
result, and includes safety and preservation boundaries. Keep the Demo scenario that justified
the promotion.

If an existing criterion already describes the failure, repair the candidate. If the Runner
models the browser incorrectly for arbitrary MSkills, repair the shared framework. If repeated
clean-room generations reveal an MSkill-specific platform constraint, record it in that MSkill's
`Validated implementation constraints` section without polluting global prompts.

## Meaning of stability

Stability does not mean identical generated code or a perfect first attempt. It means fresh,
independent generations repeatedly reach a candidate that satisfies the same readable contract,
passes both TestSpecs, survives browser and visual checks, and stays inside the safety boundary
without manual repair outside the defined loop.

See [closed-loop-validation.md](closed-loop-validation.md) for the operational runbook.
