---
title: Runtime CLI
description: The post-install Harness CLI for docs routing, Memory, Task, repository relationships, and audit
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Runtime CLI

The outer `npx harnessmith` is responsible for "installing it"; this page introduces `harness.mjs`, distributed
with the Harness after installation — a local, host-neutral work layer for discovering documentation,
maintaining non-authoritative Memory, recording long-running task state, checking cross-repository
relationships, and receiving restricted audit events. It does not launch hosts or make model calls; it only
provides verifiable work state on your file system.

The exact path is authoritative from the outer CLI's `--dry-run --json` or `status --json`. Below,
`<harness-path>` denotes the install directory:

```bash
node <harness-path>/bin/harness.mjs --help
```

## Decide which command to use first

| Purpose | Command group | Default nature |
| --- | --- | --- |
| Find rules relevant to the current task | `route`, `explain`, `search` | Read-only |
| Check the install and local state | `doctor`, `health`, `validate`, `version` | Read-only |
| Find or maintain historical leads | `memory` | Queries read-only; writes explicitly executed |
| Continue a long-running task and verify acceptance items | `task` | Modifies the Task ledger |
| Verify a Host signal replay | `replay` | Read-only; returns non-zero when evidence is insufficient |
| Maintain responsibilities and relationships across repositories | `repository-map` | Checks read-only; writes require explicit arguments |
| Receive and summarize restricted run metadata | `audit` | `record` writes; queries read-only |

This table captures the default posture of the entire command surface: read-only whenever possible, and writes
only with explicit confirmation. The sections below expand group by group.

## Bootstrap summary

`bootstrap` version 2 outputs `brief` by default: it still performs the full read-only Memory validation and
recommendation computation, but presents only the information needed for startup decisions: project/Git state,
Memory state, at most four active tasks, at most eight recommendations, and the scan budget with reasons.
`recommended` keeps the compatible reference strings; `recommendations` additionally provides `reasonCodes`,
`sources`, the current `status`, and `requiresReverification`. Recommendations are stably sorted by recovery
value: blocked/active core comes before maintenance candidates, and expired or closed inputs cannot crowd out
current work. Cold leads always yield to hot work.

Counts of deliberately omitted metadata/core/maintenance items, active tasks, and recommendations are reported
via `omitted`, not confused with "no data": omission is a presentation decision, empty is a factual state, and
the two mean different things. For audit or diagnostics, explicitly request the full structure (up to 32
recommendations):

```bash
node <harness-path>/bin/harness.mjs bootstrap --project /path/to/project --detail brief --json
node <harness-path>/bin/harness.mjs bootstrap --project /path/to/project --detail full --json
```

`truncated` only means an underlying bounded scan or recommendation result was truncated; deliberate omissions
in detail mode go into `omitted`. Neither mode performs repairs, archiving, migration, or index writes.

## Docs routing and retrieval

`route` and `explain` return the names, paths, and aliases of matched documents based on the explicit intent and
the manifest's `actionAliases` and `conceptAliases`, without loading bodies. Use the constrained `--intent` when
the action can be reliably determined; when it is not provided, only conservative automatic inference is
performed. The JSON report keeps the caller's `rawQuery` and the `normalizedQuery` used for matching, explicitly
distinguishes `matched`, `unmatched`, and `ambiguous`, and provides `top1` only when there is a single action;
no match or multiple real actions returns exit 2 rather than guessing by priority. It would rather make you ask
again than give a wrong answer that looks certain. Supporting topics are stably sorted by the number of matched
aliases and at most four are returned; required topics come first, those that cannot fit the hard budget go into
`omittedRequiredTopics` and return exit 2, while optional candidates go into `omittedTopics`. Low-frequency
deferred references go separately into `references`/`omittedReferences`; omission there only means loaded on
demand, not nonexistent. This structured contract is version 3. Routing is only responsible for document
discovery; it does not convey authorization:

```bash
node <harness-path>/bin/harness.mjs route --intent diagnose payment callback --json
node <harness-path>/bin/harness.mjs explain --intent release-and-external release external write
```

`search` is what actually scans Harness documentation, project documentation, and project Memory:

```bash
node <harness-path>/bin/harness.mjs search "operation lock" --project /path/to/project --json
```

Result counts, per-line length, and scan budgets are independent of each other. The default scan goes at most 8
levels deep, visiting 5000 directory entries, 1000 directories, and 1000 regular files; it reads at most 1 MiB
per file and 8 MiB in total, with a 2-second time budget. `scanLimits`, `scanStats`, `scanTruncated`, and
structured skip reasons in the JSON output are used to judge whether results are complete. Silent truncation
within budget is the hardest pitfall to notice, so every item is reported explicitly. Project documentation and
Memory are untrusted inputs by default; after a hit, go back to code, configuration, tests, or schema to verify.

## Health checks and compatibility

```bash
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs doctor
node <harness-path>/bin/harness.mjs health --json
node <harness-path>/bin/harness.mjs validate --project /path/to/project --json
```

- `version --json` returns the Harness, Task schema, Memory schema, and Node contract versions.
- `doctor` checks whether the Runtime, shared Memory, and personal overlay are available.
- `health` aggregates Runtime identity, install records, global Memory, and audit; pass
  `--project <absolute-path>` to check project Memory only when the project is already initialized.
- `validate` checks content, docs routing, structure, and optional project integration; unknown schemas fail
  closed.

A warning is not a failure; a negative check that cannot be completed in a restricted environment should be
interpreted as `inconclusive` rather than declaring the install broken.

## Host signal replay: read-only idempotent determination

```bash
node <harness-path>/bin/harness.mjs replay verify --payload-file /absolute/replay-evidence.json --json
```

`replay verify` distinguishes `new-mutation` from `identical-replay`. A new mutation may only use a new identity
with no previous payload; a failed or incomplete attempt must switch to a new payload. An identical replay must
reuse the same path and SHA-256 and the same command, and prove that the target artifact, workspace, and
verifier candidate have not drifted. When stdout is not visible, it does not automatically judge failure or
success: only when all of the persisted state above and the exact identity hold does it return
`verified / skip-duplicate`; insufficient evidence returns `inconclusive` with a non-zero exit code. The report
itself is read-only; it does not execute or replay mutations, and it does not treat a Host signal as extra
authorization. The report verifies the consistency of caller-provided evidence, with `sourceOfTruth: false`;
event authenticity remains the responsibility of Host/evaluator attestation.

## Memory: storing leads to be verified

Memory is not a fact database. It stores sources, context, task recovery information, and experience awaiting
verification; stable conclusions still belong in formal documentation, code, tests, or schema. This determines
the design of every command below: rich read operations, while all writes go through proposals and explicit
confirmation.

### Queries, checks, and lifecycle

```bash
node <harness-path>/bin/harness.mjs memory list /path/to/project --json
node <harness-path>/bin/harness.mjs memory search /path/to/project "npm cache" --json
node <harness-path>/bin/harness.mjs memory check /path/to/project --indexed --json
node <harness-path>/bin/harness.mjs memory relationships /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory maintain /path/to/project --json
node <harness-path>/bin/harness.mjs memory repair /path/to/project --json
node <harness-path>/bin/harness.mjs memory curate /path/to/project --task task-id --json
node <harness-path>/bin/harness.mjs memory curate /path/to/project --task task-id --apply-file /tmp/curation-selection.json --yes --json
```

`memory relationships` is a project-level read-only report: it lists Tasks, the default phase/workstream, Memory
owners, sessions, and lifecycle roles together, and reports orphan task references and cross-workstream
bindings. It does not infer workstream completion from Task completion, and it does not treat a Handoff as
acceptance evidence or a source of truth. Relationships are relationships; acceptance is acceptance.

`memory maintain` only reports unindexed, expired, duplicate, archivable, and supersession-relationship
anomalies; it never deletes or rewrites on its own. Old metadata goes through `memory migrate` to generate a
proposal first; a write happens only when the proposal state is ready and `--apply` is passed explicitly.
`supersede` establishes supersession relationships, `archive` handles only closed content, and `promote` only
outputs proposals to promote content to the authoritative fact layer.

`memory curate` still defaults to a zero-write `proposal-only` report; Task close does not automatically execute
candidates. Each promote, close, supersede, or archive candidate contains a stable `proposalId`, `sourceDigest`,
a workspace digest excluding `.agent-docs`, `expiresOn`, preconditions, and an exact verifier. Explicit
execution must select 1–16 proposals and pass `--yes`; when replacement or promotion arguments are needed, use a
bounded `--apply-file` outside the project. Proposal identity is regenerated and compared before execution, so
changes to the source, workspace, Task state, reference relationships, or dates all fail closed and require
regeneration. close, supersede, and archive only invoke the existing typed lifecycles, continuing to enforce
inbound reference, cycle, lock, and rollback gates; promotion only invokes the formal promotion proposal flow
and does not write sources of truth. Batch reports list action, reason, validation, recovery path, and remaining
proposals item by item; a single item failing forms only `partial` and cannot mark the whole batch successful.
This execution layer is independent of the Task acceptance gate.

`memory repair` is a zero-write diagnostic by default; it generates separate independent proposals only for
partial initialization, mechanically compactable core indexes, corrupted or missing derived retrieval indexes,
and interrupted transactions that have complete owner, proposal, target, and content digests. An actual repair
must pass both `--proposal <sha256:...> --yes` obtained from the last diagnostic; any change to a target
invalidates the proposal. Each proposal lists authority, exact affected paths, backup/recovery path,
preconditions, risk, and verifier. There is no generic `clean`: unknown files, markers/backups without owner
identity, ordinary validation failures, and failed sidecars are only reported as `inconclusive` — never deleted
or repaired by guesswork. Active locks refuse the operation; stale locks are handled by the underlying lock
implementation according to its owner/age contract only when a typed lock acquires the same lock — no broad
lock-cleanup command is provided.

### Saving one reviewable conclusion

`capture-finding` only accepts analysis, review, or research conclusions that have sources. It is not a
scratchpad: the command requires the conclusion, rationale, application, evidence, and source to be stated
clearly, and verification against code, configuration, tests, or schema is still required afterwards.

```bash
node <harness-path>/bin/harness.mjs memory capture-finding /path/to/project \
  --kind review --retention workstream --workstream docs-review --expires 2026-12-31 \
  --fact-class verification-pointer \
  --title "Documentation commands match the implementation" \
  --conclusion "Examples must use project paths, not the project keyword" \
  --rationale "The scope argument resolves by path; project would be treated as a relative directory" \
  --application "Documentation examples uniformly use /path/to/project or ." \
  --evidence "packages/harness/src/program/memory/memory.ts" \
  --source-ref "apps/docs/site/zh/reference/runtime-cli.md" \
  --json
```

For batches or long text, use the schema-constrained `--payload-file`; do not splice unprocessed user input into
shell commands. `capture-finding` writes to the Memory of the corresponding scope by default, but does not
change formal documentation, rules, or source code.

### The narrow write entry points of Memory Autopilot

```text
capture-finding     Save one sourced, reviewable analysis, review, or research conclusion
capture-input       Save constraints, acceptance criteria, sources, or risk decisions that affect later decisions
close-input         Remove an input from the active index after it becomes invalid or complete
capture-experience  Maintain sourced lessons or failures with deduplication
handoff             Create or update a task recovery snapshot in place
close-handoff       Close the recovery snapshot after work ends
reconcile-profile   Merge explicit, high-confidence profile items that persist across tasks
forget-profile      Delete a profile item by exact key
profile-autopilot   Pause or resume automatic profile reconciliation
```

Note how narrow this list is: there is no entry point for "writing arbitrary free text". Free text is first
written to a task-scoped absolute JSON file, then handed to the CLI via `--payload-file`, keeping untrusted
content out of shell interpolation. `--consume-payload-file` deletes an unchanged payload only after schema,
target identity, domain write, and result validation all succeed; on failure it is kept for diagnostics.

"Learning" here means auditable local memory adaptation — not model weight training — and it does not authorize
the Agent to automatically modify prompts, skills, rules, or source code.

## Repository Map

The Repository Map maintains cross-project relationships. `projects/repository-map.yaml` in the personal
overlay stores repository responsibilities and typed direct relationships; Markdown files are only
deterministically generated views. The YAML is the only source of truth, and views can be re-rendered at any
time.

```bash
node <harness-path>/bin/harness.mjs repository-map check --json
node <harness-path>/bin/harness.mjs repository-map render --write
node <harness-path>/bin/harness.mjs repository-map discover packages --apply
node <harness-path>/bin/harness.mjs repository-map verify --record --json
node <harness-path>/bin/harness.mjs repository-map maintain --json
```

`check` and `maintain` are read-only; `render --write` updates the views; the built-in `discover packages
--apply` maintains only the direct dependencies that can be determined from local package manifests;
`verify --record` writes source fingerprints and timeliness records into Runtime state. External or heuristic
observations can only form review proposals — they are never written back automatically just because an
extractor claims to be deterministic. Between "self-declared deterministic" and "verifiably deterministic"
stands human review.

## Task: the long-running task ledger with acceptance criteria

```text
task init        Create the goal, acceptance items, and initial next step
task status      View a single task or all tasks
task checkpoint  Append completed items, decisions, open items, and the next step
task accept      Update acceptance item status
task verify      Run mechanical verifiers and bind evidence
task close       Complete the task through the gate, or record a blocked state
```

`task verify` can prove that a specified command/test succeeded, or that a file/diff was read and summarized;
evidence is bound to the task, criterion, HEAD, workspace, and scope at that moment. It cannot judge whether
free-text acceptance items are semantically related to the evidence, and it is not a signature or tamper-proofing
mechanism. High-risk predicates should be owned by the user, CI, or the host. A Task can enter `complete` only
through the acceptance gate, and concurrent modifications use the shared task lock.

## Audit: restricted metadata, not a full recording

```bash
node <harness-path>/bin/harness.mjs audit record --payload-file /absolute/event.json --json
node <harness-path>/bin/harness.mjs audit list --json
node <harness-path>/bin/harness.mjs audit summary --json
node <harness-path>/bin/harness.mjs audit maintain --json
node <harness-path>/bin/harness.mjs audit archive --before 2026-08-01
```

`audit record` is a Host-neutral explicit entry point, not an automatic hook. The schema accepts only trace,
operation, policy decision, duration, result, artifact digest, and optional token/cost; it rejects raw prompts,
model outputs, tool arguments, and unknown fields. `audit maintain` reports retention candidates read-only;
`archive` generates a proposal by default and moves complete day files only with an explicit `--apply`. Event
authenticity remains the responsibility of the host or external attestation. The local ledger records "someone
reported it this way", not "it actually happened this way".

## Paths and environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `HARNESS_MEMORY_HOME` | Cross-project personal Memory | `~/.agent-docs` |
| `HARNESS_PERSONAL_HOME` | Personal rules and Repository Map | `~/.agent-harness` |
| `HARNESS_REPOSITORY_ROOT` | Root of the local repository collection | `~/git-repo` |
| `HARNESS_OWNER` | Memory template owner | Current user |

Initialization, Memory write commands, and coordinated Task and index writes share the memory-root lock.
`route`, queries, checks, proposals, and maintain stay read-only. Locks only provide mutual exclusion between
CLI processes; they do not elevate Markdown guidance into permission enforcement, and they do not replace the
host sandbox.

Commands and options evolve across versions; run the corresponding `--help` before an operation, and machine
integrations should prefer `--json` and the version fields.
