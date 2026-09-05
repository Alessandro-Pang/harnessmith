---
title: Design principles
description: Harnessmith's key trade-offs explained as problem, decision, and cost
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Design principles

No abstract slogans here: the main trade-offs are explained as "problem → decision → cost." Every principle corresponds
to an engineering problem that keeps recurring; the cost is written down too, so you can judge why a seemingly
reasonable feature is not in the current scope.

Each principle unfolds in three parts: the **problem** is the dilemma faced at the time, the **decision** is the
position finally taken, and the **cost** is what that position gives up.

## Local first: a personal way of working should not depend on a cloud control plane

**Problem.** Personal rules, task history, and project leads may contain sensitive paths or work habits; if the core
flow must connect to a remote service, offline use, privacy, and portability all get worse — and you cannot audit where
the data went. A practical scenario: you open Codex on a plane, wanting to continue yesterday's cross-repo refactor.
If rules routing and Memory lived remotely, you could not even look up "where did I get to last time."

**Decision.** The Harness, Memory, Task, and the bounded audit are stored on the local file system by default, managed
with schema and CLI. Every piece of state is a file you can open and read, not a remote black box. `~/.agent-harness`
is your personal rules and cross-repo relationships, `~/.agent-docs` is your cross-project Memory, and
`<project>/.agent-docs` is project work state — all local directories you can inspect directly with `ls`, `cat`, and
`grep`, and pack up with `export`.

**Cost.** Harnessmith provides no cross-device cloud sync, centralized team policy, or trusted remote attestation; if
needed, those capabilities should be carried by explicitly chosen external systems, not quietly built in. Local first
means one `export` / `import` when you change machines, instead of automatic sync. That is deliberate, not a missing
feature.

## Host-neutral without pretending hosts are the same

**Problem.** A personal method deserves reuse across hosts, but different coding agents really do differ in paths,
rule formats, activation mechanisms, and permission systems. Pretending they are the same leads either to a
lowest-common-denominator version or to silent errors in the details. For example, Codex's rules entry is
`~/.codex/AGENTS.md`; Cursor keeps `.mdc` files under `<project>/.cursor/rules/`; Claude Code uses
`~/.claude/CLAUDE.md` — different paths and formats that cannot simply be copied. More interestingly, the same rule
text takes effect differently per host: Cursor MDC rules can be set to `always` mode, Codex global rules load in every
session by default, and Claude Code's `CLAUDE.md` is referenced according to project context.

**Decision.** General content stays in the embedded Runtime; differences go into the outer Adapter; capability
descriptors explicitly record each host's scope, activation, and owner instead of flattening them away. When you see
`"scope": "global"` and `"activation": "host-default"` in an Adapter, behind those two lines is the Adapter's concrete
implementation of host paths, environment variables, rule formats, and activation mechanisms. But those details stay
encapsulated inside the Adapter and never pollute the general Harness template.

**Cost.** Adding a host is not "copy one directory and done"; each host's official path contract and real behavior must
be verified one by one — which is why the support list grows conservatively. Every new Adapter goes through the
complete preflight tests (dry-run, install, status, embedded-Runtime validation, and uninstall). No shortcuts.

## Progressive disclosure: the entry point is a map, not an encyclopedia

**Problem.** Historical docs must keep decisions and evolution records, but keeping all history and process resident
in the context drives cost up quickly: key boundaries drown in outdated, weakly related, or mutually conflicting
content, and wrong-recall and hallucination risks rise together. A typical trap: you stuff 500 lines into `AGENTS.md`
— security rules, per-repo release processes, three generations of test commands, two obsolete CI configuration notes
— and every conversation loads all of it into the context. Finding the truly relevant 20 lines out of 500 not only
spends the context budget but may also be misled by outdated information.

**Decision.** `AGENTS.md` keeps only high-loss rules and the discovery order; route returns one primary playbook plus
the required topics first; search returns match summaries first and reads bodies on demand. The entry file stays within
50 lines; concrete procedures are loaded precisely by docs routing per `--intent` when needed. The benefit: the entry
stays readable, the agent never misses a key red line because of historical overload, and historical docs remain fully
preserved in `docs/` and `.agent-docs/` for tracing.

**Cost.** Docs must continuously maintain metadata, status, indexes, and clear routing; an orphan doc without an entry
point might as well not exist, and preserved history must always remain distinguishable from current facts.
Progressive disclosure presupposes "every doc has explicit metadata and routing" — that requires continuous docs
governance, not write-once-and-done.

## Separate guidance from enforcement

**Problem.** Natural-language rules are useful but cannot guarantee the model follows them every time. Calling "the
docs say so" "the system enforces it" creates false security; you only discover the docs had no binding force when
something goes wrong. For example, your rules say "never run `git push --force`" and the agent acknowledges the rule
in conversation, but the host permission system does not restrict network access — in some version of its reasoning the
model may still run it.

**Decision.** Suggestions go into rules and playbooks; constraints that must hold go into SafePath, schema, state
machines, tests, CI, or the host permission system. Say explicitly which layer guarantees what. Harnessmith's docs may
say "remote writes require explicit authorization," but what actually blocks the write is the host sandbox and
permission system. Harnessmith writes that down clearly and does not pretend it can enforce.

**Cost.** Some cross-host behaviors can only be declared advisory or delegated; uniform Markdown cannot make them
mandatory. For example, "all tests must pass before release" is a natural-language suggestion inside Codex and a
mechanical gate inside CI. Harnessmith can help you write the test command into the rules, but what actually blocks a
failing release is the `&&` in the CI configuration, not words in Markdown.

## Safe failure and recoverable changes

**Problem.** Once a configuration installer overwrites user files or leaves a half-finished state, the loss far
exceeds one failed install. What users lose may be rules accumulated over a year. For example, you have maintained 200
lines of repeatedly verified rules in `~/.codex/AGENTS.md`, and an install script overwrites it directly — with no
backup.

**Decision.** Deny by default whenever a target cannot be proven safe to take over. Install, restore, and uninstall
share containment, path-segment checks, locks, full preflight, backups, and exact rollback. Every write operation goes
through the 7-step safety check (canonicalize → validate containment → lstat rejects symlinks → acquire the operation
lock → stage → full re-check before commit → exact rollback on failure); any failing step stops everything, leaving no
half-finished state.

**Cost.** The flow is more conservative: on unmanaged or modified files it asks users to understand the difference
first instead of taking over automatically. That means a few more minutes reading dry-run output, in exchange for an
install record you can definitely roll back.

## State helps work without usurping the source of truth

**Problem.** Cross-session tasks need persistent state, but historical records go stale and may only have been an
inference at the time. A conclusion that held yesterday may have been invalidated by one rebase today. For example,
Memory records "the project uses npm as its package manager," but last week someone migrated to pnpm; if the agent
reuses that Memory without checking `package.json`, every following command uses the wrong tool.

**Decision.** Memory is defined as non-authoritative leads; Task is the work contract and evidence ledger. Current
conclusions must still be verified against code, configuration, tests, schema, and formal docs. Memory's data
structure has a `source-of-truth: false` field marking explicitly that it is not the source of truth. That is not
modesty; it is a designed safety mechanism.

**Cost.** The system does not automatically promote every experience into a long-term rule; distillation needs an
explicit target and review — human judgment cannot be skipped. You can manually promote a Memory lead into a formal
rule, but it goes through the proposal → review → apply flow. One conversation cannot automatically write "today I
discovered project X uses pnpm" into the rules, because tomorrow it may change back.

## Claims must bind proportionate evidence

**Problem.** "Local tests passed," "a real host ran it," and "the candidate can be released" answer three different
questions; mixing them yields an "all passed" that proves nothing. For example, in one release: unit tests all green,
lint clean, coverage met — but nobody ever ran the install flow in a real host. Those three green checks together
cannot prove "users running `npx harnessmith` will succeed."

**Decision.** Public capabilities are divided into implemented, delegated, and unsupported; verification is divided
into deterministic repository gates, Host Eval, record validation, and human review. Constrained negative results use
`inconclusive` instead of impersonating conclusions. The four verification levels each own their job: gates own
internal repository consistency, Host Eval owns real host behavior, record validation owns evidence format, and human
review owns semantic judgment.

**Cost.** Release notes must keep the unverified scope; one aggregate pass status cannot replace the explanation of
evidence. Every release must state clearly "which hosts completed Host Eval this time, which only passed repository
gates, and which are marked inconclusive." It is more work to write, but readers know how far to trust it.
