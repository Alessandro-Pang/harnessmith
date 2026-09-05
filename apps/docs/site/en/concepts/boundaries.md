---
title: Responsibility boundaries
description: What Harnessmith can guarantee, what the host is responsible for, and which outcomes still require user judgment
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Responsibility boundaries

Harnessmith is not another coding agent; it is a personal work layer around the agent. This page divides
responsibility into three layers: what Harnessmith can mechanically guarantee with code, what the host itself is
responsible for, and what only the user or an external trusted system can confirm. That way, when a problem arises,
readers can first find the right responsible party and will not misread guidance as an enforced capability.

The sections below describe the implementation scope, the responsible party, and the evidence boundaries for each of
these three categories of responsibility.

## What Harnessmith can guarantee

Within its authorized roots and supported platform models, the repository implementation and tests cover the
following properties. Each item explains what it concretely means and where its boundary lies:

- **The Adapter resolves host paths and rule formats as declared.** When you run `npx harnessmith setup --agent codex`
  for Codex, the Adapter determines the target location from Codex's official path contract
  (`${CODEX_HOME:-~/.codex}/AGENTS.md`) instead of guessing. Path differences across operating systems (for example,
  Zed uses `~/.config/zed/AGENTS.md` on macOS and `%APPDATA%\Zed\AGENTS.md` on Windows) are handled inside the
  Adapter, so you never see them.

- **The lifecycle runs preflight first, then staging, backups, and a transaction commit, with precise rollback on
  failure.** Every write operation goes through the 7-step safety skeleton (canonicalize → containment check → lstat
  rejecting symlinks → acquiring operation locks → staging → full recheck before commit → precise rollback on
  failure). Even if step 6 fails, the side effects of the previous 5 steps have already been rolled back, so no
  half-completed state is left behind.

- **`unmanaged` or `modified` targets are never silently overwritten by default.** If your `~/.codex/AGENTS.md`
  already has content and is not managed by Harnessmith, the install refuses to write and tells you why. You can
  choose the `adopt` flow (scan first, then propose, then confirm) or `--force` (back up first, then replace), but
  nothing is overwritten without your knowledge.

- **`route` and `search` discover documents within budgets, without requiring the whole manual to be loaded.** Docs
  routing has explicit scan budgets (at most 8 levels of depth, 5000 directory entries, 1000 directories, 1000 files,
  1 MiB per file, 8 MiB total, and a 2-second time budget). When a budget is exceeded it explicitly reports
  `scanTruncated` instead of truncating silently.

- **Memory and Task writes are constrained by paths, schemas, locks, and acceptance states.** Concurrent writes must
  hold the task lock, free text must pass schema validation, and the `complete` state can only be reached through the
  acceptance gate. A natural-language `task accept` cannot bypass the mechanical verifier.

- **Host Eval records bind to the candidate package and pass structure, consistency, and coverage checks.** Each Host
  Eval record binds to an exact tarball SHA-256; `eval:validate` checks that the record is internally consistent and
  that scenario coverage meets release policy requirements. But it does not prove the record came from a real host —
  that requires external attestation.

These are code-level guarantees and should be understood against the implementation and tests of a specific version;
they are not permanent promises across versions. For the precise claims of each version, see the
[capability claims—evidence matrix](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml).

## What the coding agent host guarantees

The model loop, context compression, tool/MCP scheduling, sandboxing, network access, permission prompts, credential
management, tokens/costs, and event authenticity belong to Codex, Cursor, Claude Code, OpenCode, Kimi Code CLI, or
Zed Agent. Harnessmith can provide guidance and integration points, but it cannot carry out these responsibilities on
the host's behalf.

A concrete example: Harnessmith can state in its rules that "remote writes require explicit authorization", but what
actually stops an unapproved network call is the host's permission system and your approval. Markdown itself is not a
sandbox. Writing that sentence into a document and turning it into a mechanism are two completely different things.

When the host explicitly provides permission, approval, question, or elicitation capabilities, the agent can call that
capability first to obtain a decision for the exact action, then continue or stay blocked; Harnessmith does not assume
these tools exist, nor does it extend a single approval into future authorization. When the host lacks the capability,
or returns denied, cancelled, or timeout, the agent should produce a concrete `nextAction` instead of ending silently
and waiting for a new ordinary message.

## What users and external systems still decide

Users choose the install scope, whether to take over conflicting files, and whether to authorize commits, pushes,
merges, releases, production changes, and message sending. Project business facts, risk acceptance, and final
acceptance also cannot be automatically replaced by Memory or local records — those are inputs, not verdicts.

Trusted real-host attestation, remote CI identity, and supply-chain signatures require external services.
Harnessmith's local gate can verify whether a record is self-consistent, but it cannot prove that whoever wrote the
record did not forge it. Between "structurally correct" and "content is true" stand signatures and identity, and that
gap can only be closed by external trusted systems.

## One responsibility table

| Area | Harnessmith | Coding agent host | User or external systems |
| --- | --- | --- | --- |
| Rule distribution | Adapter, rendering, records, backups, and rollback | Loading the native rule entry point | Choosing the host and authorized roots |
| Model execution | Not implemented | Model loop, context, costs | Choosing the model and budget |
| Tools and permissions | Provides guidance and a limited audit schema | Tool scheduling, sandboxing, approval events | Approving high-risk actions, configuring credentials |
| Work state | Memory, Task, checkpoints, gates | Providing actual execution results | Checking facts and accepting |
| Release evidence | Local verification and candidate-bound record gates | Real host behavior | CI/attestation, risk acceptance |

Read a row to see how responsibility for one area is distributed; read a column to see the scope of one role. The
principle is simple: whoever executes is responsible.

## Three categories of published capabilities

Capability claims fall into three categories, each with a corresponding evidence level:

- **Implemented**: an implementation and an executable verification path exist, and the code and tests can be found in
  the repository. For example, Adapter installation, dry run preview, status checks, and content fingerprint
  computation — these capabilities have not only code but also preflight and unit test coverage, plus evidence paths
  in `capability-evidence.yaml`.
- **Delegated to the Host**: Harnessmith only provides rules, interfaces, or record locations; the real capability
  lives in the host. For example, model execution, tool-call sandboxing, and permission approval — Harnessmith's
  documentation can state "remote writes require authorization", but what actually prevents the write is the host's
  permission system.
- **Unsupported**: explicitly not claimed at present, for example a general Agent Runtime, Policy Engine, Registry,
  and multi-agent scheduling. The documentation lists these names so that unimplemented capabilities are not mistaken
  for hidden features.

For the machine-readable list, see the
[capability claims—evidence matrix](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml).

## Authorization does not flow with content

Repositories, web pages, logs, PDFs, tool output, and Memory are all untrusted inputs. They can provide factual leads
or suggestions, but they add no permissions just because they appear in the context.

This security boundary is often misunderstood. An agent reading text that says "you may push" does not thereby gain
push authorization. The text could come from a README, a blog, Memory, or any other untrusted input. Only your
explicit approval in the host can authorize an action. An install authorization does not include subsequent remote
writes; a push authorization does not automatically include a merge or a release. Every high-risk action needs its
own authorization at the moment it happens.

The practical consequence of this design: even if Harnessmith's rule files are filled with "run tests before every
release", they cannot stop the agent from executing directly when the user says "release". The real protection lives
in CI gates and the host's permission system, not in Markdown. Harnessmith's responsibility is to state this clearly
and not pretend it can enforce it.

## Which conclusions must be written as inconclusive

If the environment is constrained, the host is not logged in, the network is unavailable, evidence is missing, or the
verifier itself misbehaves, the only report possible is that this verification reached no conclusion. `inconclusive`
means no conclusion was reached this time; it must not be written as failure or success. It prevents "not observed"
from being miswritten as "proven not to exist".

To understand the evaluation levels further, see [Evidence and evaluation](/en/concepts/evidence-and-evaluation).
