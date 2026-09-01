# Gemini / Antigravity operational guardrails

This reference covers transport reliability, permissions, search behavior, run receipts, and context/quota hygiene. It does not replace the serious forensic or implementation contracts.

## Transport resolution

Prefer the user's already-authorized Gemini/Antigravity transport. Commonly:

```text
$CODEX_HOME/skills/gemini-antigravity/scripts/ask_gemini.sh
```

Resolve `CODEX_HOME`; do not hard-code `/Users/<name>`.

A transport run should have a unique role/task label. When supported, set a bounded print/task timeout and retain the returned Antigravity conversation ID and terminal status.

Do not silently switch to Gemini API/Vertex billing because the subscription transport failed.

## Permissions

For read-only audits:

- prefer an immutable export or task-owned read-only worktree;
- allow only the roots actually needed;
- normal file reads/searches should not require repeated interactive approval once the workspace is correctly trusted;
- do not widen the entire home directory just to avoid one prompt.

For implementation:

- use a task-owned worktree;
- full autonomous permission is acceptable only when the user has explicitly authorized unattended mutation and the blast radius is constrained to that task-owned root;
- never use global dangerous permission bypass merely for convenience.

If Antigravity repeatedly asks despite an allow rule, inspect its actual project/global permission rules and precedence instead of clicking forever.

## Search discipline

Do not recursively crawl broad home directories by default.

Prefer:

```text
rg --files <bounded-root> | rg -i '<pattern>'
rg -n '<pattern>' <bounded-root>
git grep -n '<pattern>' <immutable-sha> -- <bounded-paths>
```

Use native file-search/view tools where available.

Avoid broad forms such as:

```text
find ~/.codex ~/.gemini ~/.config ~/.cursor ~/.claude ...
```

unless the task truly requires every tree and the command is bounded/time-limited.

If a command has no observable progress for roughly 30–60 seconds and should normally be quick, cancel it, narrow the root, and use a more appropriate primitive. A stuck shell command is not model reasoning time.

## File-reading discipline

- Search for symbols/phrases before opening a whole large file.
- Read the smallest contiguous range that can prove/disprove the current hypothesis.
- Avoid repeatedly re-reading the same full file in one conversation.
- When context becomes large, create a compact evidence handoff and start a fresh role/conversation.

## Run receipts

When the transport exposes run logs, retain at least:

```text
run_label
role
source_identity
started_at
ended_at
elapsed_seconds
model
reasoning_effort
terminal_status
conversation_id
output_event_count
```

These fields measure operation and cost. They do **not** prove correctness.

For serious work also retain:

```text
verdict
candidate_or_diff_identity
proof_command_or_test
proof_result
material_disagreement
remaining_uncertainty
```

## Transcript handling

Antigravity may store both compact run records and detailed conversation/trajectory data. Use the detailed transcript only when needed to audit what was actually read/called or diagnose a failure. Do not feed the full trajectory into every reviewer; that destroys independence and wastes context.

Prefer a compact evidence packet extracted from the final claim plus exact cited source/test evidence.

## Quota hygiene

- Do not run multiple identical agents just because capacity is available.
- Two distinct serious roles are the default ceiling: investigator+falsifier or implementer+reviewer.
- A third judge is conditional on concrete disagreement/high risk.
- Fresh bounded conversations usually waste less context than one giant session repeatedly carrying old tool output.
- Track quota by completed verified work, not prompts or elapsed time alone.
- If one task repeatedly burns quota, inspect context growth, duplicate file reads, and unnecessary broad searches before upgrading the plan.

## Failure policy

If a Gemini run fails, times out, or loses transport state:

1. preserve the original run/receipt identity;
2. determine whether the task actually started and whether a final result exists;
3. recover the existing transcript/receipt when possible;
4. retry only when the prior mutation/state is known safe or the task is read-only/idempotent;
5. reuse the same logical task label with an explicit retry suffix.

Do not interpret a transport failure as evidence about the model's conclusion.
