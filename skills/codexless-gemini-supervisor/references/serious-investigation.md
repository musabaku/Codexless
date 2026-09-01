# Serious Gemini investigation protocol

Use this contract for latent correctness, data-integrity, auth/security, migration, routing/state-machine, financial/accounting, or other forensic work where a plausible-looking answer is not enough.

## Shared immutable task envelope

Every competing run receives the same:

- task statement;
- repository/worktree root;
- immutable Git SHA/tree/export identity when available;
- allowed scope and exclusions;
- allowed tools and mutation policy;
- maintained docs/tests that define authority;
- required output schema.

Do not silently broaden one run and not the other.

## Investigator role

The investigator is not allowed to stop at the first plausible defect.

Required behavior:

1. Map the smallest high-risk seam that can answer the task.
2. Generate 2–4 plausible candidate explanations when the evidence permits alternatives.
3. For each candidate, capture evidence for, evidence against, and missing links.
4. Reject candidates that fail a maintained contract/test/guard check.
5. Select the strongest surviving candidate only after comparison.
6. Attempt one explicit counterexample against the selected candidate.
7. Define the smallest deterministic proof that would distinguish it from the strongest alternate explanation.

The investigator may return `NONE_FOUND` if no candidate survives. It must not manufacture a weak finding to satisfy the task.

## Falsifier role

The falsifier's job is to make the investigator lose.

It should assume the provisional claim is wrong until demonstrated otherwise and look specifically for:

- another writer/mutator that restores the invariant;
- a transaction/guard/constraint that makes the failure impossible;
- stale or display-only code that is not authoritative at runtime;
- an existing regression test that already covers the claimed path;
- a migration or feature flag that changes the semantics;
- a different source of truth than the investigator assumed;
- a failure scenario that cannot actually be reached through the public/current call path;
- a simpler alternate explanation for the observed disagreement;
- a known historical issue already documented as fixed;
- evidence that the claimed impact is hard failure rather than silent correctness, or otherwise outside scope.

If it cannot falsify the claim, it should say why and identify the strongest remaining uncertainty. Agreement is not a vote; the falsifier must show independent evidence.

## Evidence ledger

Use this compact shape for each material candidate:

```text
candidate_id:
claim:
status: candidate | rejected | verified | needs_more_evidence
source_identity:
paths_symbols:
evidence_for:
  - ...
evidence_against:
  - ...
unverified_assumptions:
  - ...
authoritative_writers_checked:
  - ...
authoritative_readers_checked:
  - ...
guards_constraints_migrations_checked:
  - ...
relevant_tests_docs_checked:
  - ...
counterexample_attempt:
strongest_alternative:
minimal_proof:
proof_result:
confidence_basis:
```

`confidence_basis` must describe evidence quality; it must not be a naked percentage.

## Supervisor resolution

The calling AI compares the two evidence packets and classifies each disputed link as:

- `DEMONSTRATED`
- `CONTRADICTED`
- `INFERRED`
- `UNTESTED`

A serious finding is `PASS/VERIFIED` only when every link required for the failure scenario is demonstrated and the deterministic proof succeeds.

Return `NEEDS_MORE_EVIDENCE` when a required link remains inferred or untested.

Return `HOLD` when contrary evidence defeats the claim or implementation cannot be accepted safely.

## Third-judge trigger

Do not automatically spawn a third Gemini.

A judge is justified only when:

- both runs cite concrete contradictory source evidence;
- the deterministic proof is ambiguous or unavailable;
- the task is high-risk enough that unresolved uncertainty is itself a blocker.

The judge receives the original task plus compact evidence packets and the exact disputed questions. It should not repeat the entire audit.

## Prompt tail for the investigator

Append this to serious investigator prompts:

```text
A plausible candidate is NOT a stopping condition.
Before finalizing, compare plausible alternatives, record evidence for and against the selected claim, inspect the relevant authoritative writers/readers/guards/tests/docs, attempt to falsify your own candidate, and specify the smallest deterministic proof. If an essential link remains inferred rather than demonstrated, return NEEDS_MORE_EVIDENCE instead of VERIFIED. Do not use a confidence percentage as a substitute for proof.
```

## Prompt tail for the falsifier

Append this to falsifier prompts:

```text
Your role is adversarial falsification, not confirmation. Assume the provisional claim is wrong. Independently inspect the immutable source and try to find a writer, guard, constraint, migration, test, alternate authority, unreachable call path, or alternate explanation that defeats it. Report the strongest contrary evidence even if you ultimately agree. Do not accept the other model's confidence or wording as evidence. Return FALSIFIED, SURVIVES_FALSIFICATION, or NEEDS_MORE_EVIDENCE with exact source/proof support.
```
