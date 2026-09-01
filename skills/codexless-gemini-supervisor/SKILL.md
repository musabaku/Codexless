---
name: codexless-gemini-supervisor
description: Govern and supervise Gemini/Antigravity delegation from Codexless or Codex, especially when using a local gemini-antigravity transport Skill or ask_gemini.sh. Use for serious Gemini code audits, implementation, debugging, research, multi-agent comparison, reviewer/falsifier passes, quota-efficient parallel work, or when Gemini is converging too quickly. Do not use for ordinary Gemini product questions or when no Gemini/Antigravity delegation is requested.
---

# Codexless Gemini Supervisor

Use this Skill as the **governance/orchestration layer above the existing Gemini/Antigravity transport**. The transport owns authentication and the mechanics of starting Antigravity. This Skill owns task shape, independence, falsification, verification, receipts, and stopping rules.

The goal is not to make Gemini slower. The goal is to spend Gemini 3.7 Flash's speed on more independent evidence and verification instead of allowing the first plausible narrative to terminate the task.

## Core contract

- Keep the calling AI responsible. Gemini is a worker/reviewer, not the final authority.
- Do not confuse fast completion with shallow work. Judge depth from evidence coverage, counterexample search, and proof, not elapsed time.
- A plausible candidate is **not** a stopping condition on serious work.
- Never accept self-confidence, repeated wording, or agreement between sibling agents as proof.
- Serious findings must survive a falsification pass and an independently checkable proof step.
- Fresh-context review is preferred over asking one long-running Gemini conversation to review itself.
- Do not majority-vote three copies of the same model. Add agents only when their roles or evidence boundaries differ.
- Keep immutable source identity fixed across competing runs: same Git SHA/tree/export, same task, same exclusions, same allowed tools, and same acceptance contract.
- Preserve user work. Use read-only immutable Git objects for audits and task-owned worktrees for implementation.
- Do not widen trust, permissions, network authority, roots, or approval policy merely to make Gemini autonomous.

## 1. Resolve the transport without replacing it

Prefer an existing user-authorized Gemini transport Skill or wrapper. A common transport is:

```text
$CODEX_HOME/skills/gemini-antigravity/scripts/ask_gemini.sh
```

with `CODEX_HOME` falling back to the user's normal `~/.codex` home. Do not assume the path exists; resolve the current Skill first when possible.

This supervisor must not silently overwrite or mutate a user-owned `gemini-antigravity` transport Skill. If the transport is unavailable or unhealthy, report that concrete blocker instead of falling back to an unrelated paid API.

For each run, retain a stable role/run label and the Antigravity conversation/run receipt when the transport exposes one.

## 2. Classify the work before spawning Gemini

### Quick mode — one Gemini

Use one fresh Gemini run for tightly scoped, low-risk work where an error is cheap and independently obvious: narrow explanation, one small UI change, a bounded search, straightforward test generation, or a disposable prototype.

Quick mode still requires the model to cite the files or evidence it actually used. Do not add reviewer theater when deterministic tests already settle the task.

### Serious forensic mode — investigator + adversarial falsifier

Use for latent correctness bugs, cross-surface inconsistencies, migrations, security boundaries, data integrity, state machines, authorization, financial/accounting semantics, routing/dispatch semantics, or any claim that could look successful while being wrong.

Run:

1. **Investigator** — fresh context, broad candidate search, evidence ledger, provisional conclusion.
2. **Falsifier** — separate fresh context. Its job is to break the provisional claim, find an alternate explanation, discover a guard/path/test that makes the failure impossible, or identify missing evidence.
3. **Supervisor/judge** — the calling AI compares evidence. Do not choose by eloquence or vote count.
4. **Proof** — deterministic test, reproducer, immutable-source contradiction, or other independently checkable acceptance evidence.

Read `references/serious-investigation.md` before building these prompts.

### Serious implementation mode — implementer + independent reviewer

Use for multi-file or correctness-sensitive implementation.

1. Give one fresh Gemini worker the exact worktree, acceptance criteria, invariants, and tests.
2. Require the worker to run verification and self-review before claiming completion.
3. Give a **different fresh Gemini conversation** the original requirement plus the final diff/test evidence. Do not give it the implementer's hidden trajectory.
4. Reviewer returns `PASS` or `HOLD` with concrete blockers.
5. If `HOLD`, send blockers back to the implementer or a fresh repair worker, then re-review the new immutable diff.

Read `references/implementation-review.md` before building these prompts.

### High-risk disagreement mode — conditional judge

A third model/run is an exception path, not the default. Use it when:

- investigator and falsifier materially disagree;
- the proof is ambiguous;
- security, money, destructive migration, auth, or irreversible data semantics are involved;
- a critical claim rests on an inferred rather than demonstrated link.

Give the judge the original task and compact evidence packets from both sides. Ask it to resolve specific disputed claims. Do not ask a third agent to repeat the entire repository audit.

If the user has separately authorized a stronger Codex/Claude reviewer, that model may serve as judge. This Skill does not itself grant permission to start a metered formal Codex agent.

## 3. Serious prompts must force falsification

For serious work, the Gemini prompt must require all of the following before `VERIFIED`:

- candidate hypothesis or implementation claim;
- strongest evidence **for** it;
- strongest evidence **against** it;
- assumptions that remain unverified;
- authoritative writers/mutators relevant to the state;
- authoritative readers/projections that would expose the claimed disagreement;
- relevant guards, migrations, tests, and maintained contract docs;
- at least one explicit attempt to construct a counterexample or alternate explanation;
- the smallest proof test/reproducer/assertion that would distinguish the claim from its strongest alternative.

If a necessary link is inferred rather than demonstrated, return `NEEDS_MORE_EVIDENCE`, not high confidence.

Never use `100% confidence` merely because several files contain consistent-looking text.

## 4. Protect independence and context quality

- Use a **new Antigravity conversation** for every investigator, falsifier, reviewer, or judge role.
- Keep the same immutable source snapshot across competing runs.
- The falsifier/reviewer may receive the other agent's compact final claim/evidence packet when critique requires it, but should not inherit the full trajectory or accumulated conversation state.
- Do not keep extending a huge conversation simply to preserve context. When a run becomes broad, create a compact handoff containing task, source identity, decisions, evidence, unknowns, and exclusions, then start fresh.
- Never let a previous model's confidence become evidence for the next model.

## 5. Use verification tools intelligently

Read-only forensic work does **not** mean "no commands ever." It means no mutation.

When authority allows, safe verification may include bounded commands such as immutable `git show`, `git grep`, `rg`, compiler/type checks, targeted tests, or a deterministic reproducer in an isolated worktree. Verification that can falsify the model is more valuable than another page of prose.

Avoid pathological searches:

- prefer `rg --files`, `rg`, or a bounded native file-search tool over recursive `find` across a large home directory;
- search the smallest justified root first;
- apply timeouts to potentially broad commands;
- if a command produces no progress for a reasonable bounded interval, cancel it and retry with a narrower/faster primitive instead of waiting indefinitely;
- do not repeatedly dump whole large files when a symbol/range search can answer the question.

Do not use `--dangerously-skip-permissions` as a global convenience on a user's home directory. If fully unattended mutation is explicitly desired, constrain it to a disposable/task-owned worktree or sandbox and preserve the normal high-risk confirmation boundary.

## 6. Evidence packets, not essays

Each serious Gemini run should return a compact machine/human-readable evidence packet. Use the schema in `references/serious-investigation.md` or `references/implementation-review.md`.

The supervisor should compare claims at the level of:

- exact source identity;
- exact paths/symbols/line ranges or test names;
- demonstrated state transition/call path;
- contrary evidence;
- proof/reproducer outcome;
- remaining uncertainty.

A longer answer is not a better answer.

## 7. Run and quota discipline

Gemini 3.7 Flash is fast enough that parallelism can consume quota before a human notices. Scale workers deliberately.

- Default serious task: **2 Gemini runs**, not 5–10.
- Add a third only for a concrete disagreement/high-risk judge condition.
- Prefer several bounded fresh tasks over one enormous conversation that repeatedly re-sends accumulated context.
- Label every run by task + role so usage can be attributed later.
- When the transport exposes run logs/transcripts, retain elapsed time, terminal status, conversation ID, event count, and role label. These are operational evidence, not correctness evidence.

## 8. Acceptance rules

A serious Gemini result is accepted only when:

- source identity and scope are fixed;
- the claim is supported by exact evidence;
- material contrary evidence was actively sought;
- a fresh independent role has challenged the result;
- the surviving claim has an independently checkable proof step;
- no unresolved contradiction is hidden behind a confidence score.

If these are not met, report `HOLD` or `NEEDS_MORE_EVIDENCE` and the smallest next action needed to resolve it.

## 9. Report to the calling AI

Return:

- mode used (`quick`, `serious-forensic`, `serious-implementation`, or `high-risk-judge`);
- run labels and source identity;
- investigator/implementer result;
- falsifier/reviewer result;
- exact disagreements, if any;
- deterministic proof/test evidence;
- final `PASS`, `HOLD`, or `NEEDS_MORE_EVIDENCE`;
- any transport/permission/quota problem that materially affected the result.

Then stop. Do not spawn extra consensus agents merely because quota is available.
