# Gemini implementation + independent review contract

Use this contract for multi-file implementation, refactors, bug fixes, migrations, or any change where a fast successful build is not sufficient evidence of correctness.

## Implementer envelope

Give the implementer:

- exact task and non-goals;
- task-owned worktree/root;
- base SHA and expected branch/diff boundary;
- maintained contracts/docs that must remain true;
- required tests/typechecks/lints/builds;
- explicit mutation permissions and forbidden areas;
- stopping condition.

Require the implementer to:

1. inspect the relevant current source before editing;
2. state a short plan for non-trivial work;
3. implement the smallest coherent change;
4. run the narrowest high-signal verification first, then broader gates as warranted;
5. inspect its own diff for accidental scope expansion, dead code, weakened guards, and test-only fixes;
6. report unresolved uncertainty instead of hiding it.

The implementer may not certify its own change as accepted.

## Independent reviewer envelope

Start a **fresh Gemini conversation** after the implementation reaches a stable diff.

Give the reviewer:

- original requirement and non-goals;
- base SHA and immutable head SHA/diff;
- relevant maintained contracts/tests;
- test/build evidence already produced;
- no hidden implementer trajectory.

The reviewer must independently inspect the changed code plus only the surrounding source necessary to validate behavior.

Required review questions:

- Does the diff actually satisfy every material requirement?
- Does it preserve existing authority/state semantics?
- Can the new code silently act on the wrong entity, date, route, user, state, or version?
- Does error handling fail closed where required?
- Are idempotency/concurrency/transaction boundaries preserved?
- Are tests proving the behavior rather than pinning the implementation text?
- Is any requirement "satisfied" only through mocks, unreachable code, or a test fixture?
- Did the implementation introduce a second source of truth or bypass the existing one?
- Is there a smaller or safer implementation that the current diff failed to use?

Return exactly one of:

- `PASS` — no material blocker found;
- `HOLD` — list concrete blockers with exact evidence;
- `NEEDS_MORE_EVIDENCE` — identify the missing proof.

Do not return `PASS` because the implementer said tests passed.

## Repair loop

If review returns `HOLD`:

1. send only the concrete blockers and original contract to the repair worker;
2. repair the same task-owned worktree or create a fresh repair worktree as appropriate;
3. rerun affected verification;
4. bind review to the **new immutable head SHA/diff**;
5. re-review until `PASS` or an explicit unresolved blocker remains.

Do not let a PASS survive a changed SHA.

## Proof expectations

Prefer behavior-level proof:

- regression test that fails on base and passes on head;
- deterministic reproducer;
- invariant/assertion over authoritative data/state;
- compile/type/build gate for interface changes;
- focused integration test for cross-layer behavior.

Textual grep assertions are acceptable only when the contract itself is textual/static and runtime proof is not meaningful.

## Prompt tail for implementer

```text
Before claiming completion, inspect your own final diff and try to find a way it could pass tests while still violating the requirement. Check authority/state identity, error paths, concurrency/idempotency where relevant, and accidental scope expansion. Run the required verification. Report unresolved uncertainty explicitly. Your self-review does not count as independent acceptance.
```

## Prompt tail for reviewer

```text
You are an independent adversarial reviewer. Do not trust the implementer's explanation or test summary. Bind to the supplied immutable base/head diff, inspect the relevant contracts and surrounding source, and try to break the change. Look for silent correctness errors, alternate writers/readers, identity/date/version mixups, bypassed authority, weak tests, and unhandled failure paths. Return PASS, HOLD, or NEEDS_MORE_EVIDENCE with exact evidence.
```
