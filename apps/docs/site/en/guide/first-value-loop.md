---
title: First Value Loop
description: An actionable path from a completed install to real host verification, and the boundaries of evidence
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# First Value Loop

An installer exit code of 0 only proves that the local transaction completed. The First Value Loop answers
more practical questions: whether a real host has read the rules, whether the agent can complete a low-risk
task according to those rules, and whether you know how to check and recover.

This page gives a path that doesn't rely on guessing. The first two states are proven by the local CLI; the
last two must be confirmed in a real host session. Without host evidence, write the result as `inconclusive`
— don't turn "files installed" into "the agent is already working correctly".

## What each of the four states proves

| State | What it proves | Primary owner | Can the local CLI prove it alone |
| --- | --- | --- | --- |
| `installed` | The install record exists, and managed files match the checksums in the record | outer installer | Yes |
| `healthy` | The embedded Runtime's deterministic health checks pass | embedded Runtime | Yes |
| `host-configured` | A real host has read the rules and has the expected authentication and permission conditions | Host | No |
| `host-verified` | A real host has completed the first controlled task, and the evidence is reviewable | Host and user | No |

`setup` and `status` cover only the first two. They don't read the host's model sessions, and they don't
approve tool calls on the host's behalf. Without evidence, `host-configured` and `host-verified` must remain
`inconclusive`.

## Recommended path: eight checkpoints

### 1. Confirm the fit

First read [Why Harnessmith](/en/guide/why-harnessmith) and
[Responsibility boundaries](/en/concepts/boundaries) to confirm that what you need is a cross-host,
recoverable personal work layer. If a short `AGENTS.md` is already enough, you can stop here.

### 2. Choose a host and scope

Codex, Claude Code, OpenCode, Kimi Code CLI, and Zed Agent use global scope; Cursor uses project scope. Check
[Host support](/en/guide/hosts) first, then decide on `--agent` and `--project`.

### 3. Preview the plan

```bash
npx harnessmith setup --agent codex --dry-run --json
```

Check the target paths, scope, file states, conflicts, backup locations, and recovery commands item by item.
Stop when you see `unmanaged` or `modified`; don't use `--force` as a substitute for understanding the
differences.

### 4. Install and check local state

```bash
npx harnessmith setup --agent codex
npx harnessmith status --agent codex --explain
npx harnessmith diagnostics --agent codex --json
```

`status` confirms install ownership and integrity; `diagnostics` runs deterministic Runtime checks. At this
point you can have at most `installed` and `healthy`.

### 5. Prepare a low-risk controlled task

Open a new host session and use a read-only task. Copy the request below directly, then replace the topic to
match the repository's actual content:

> Analyze the current repository's release process in read-only mode. List the files you read and the
> commands you ran, distinguishing code, configuration, test, and documentation facts; state which parts you
> cannot verify. Do not modify files, commit, push, send messages, or access external systems.

The task must be real enough to trigger the rule entry point, project discovery, docs routing, and
fact-checking, yet safe enough that a failure won't change the work tree.

### 6. Confirm the host loaded the rules

Confirm three things in the host's output or tool records:

1. The agent read the rule entry point for the current host;
2. It respected the read-only scope: no writes, commits, pushes, or calls to unauthorized external services;
3. It listed its sources of truth and the unverified scope, rather than giving conclusions alone.

These three items are manual or Host-owned checks, not local verifiers that `status` can replace. If the host
isn't logged in, tool records are missing, or the permission state can't be confirmed, write `inconclusive`.

### 7. Save minimal evidence

Keep at least the following: host name and version, Harnessmith candidate version, session time, the original
task text, files read or tool actions taken, work-tree state before and after, agent output, and the judgment
of the user or an independent verifier.

For the read-only task on this page, minimal reviewable evidence can look like:

```text
host: <codex|cursor|...> <version>
candidate: harnessmith <version>
task: <original task text>
observed: <rule entry point read; which files were read; which read-only commands ran>
workspace_before: <git status or file digest>
workspace_after: <same check result>
verifier: <user review / Host-owned verifier / command>
result: passed | inconclusive | failed
limitations: <authentication, network, tool records, and other limits>
```

An exit code of 0, or a final message saying "done", cannot constitute `passed` on its own. Without a direct
verifier, keep the evidence but mark the result `inconclusive`.

### 8. Confirm the recovery path

Before declaring it ready for long-term use, check:

```bash
npx harnessmith status --agent codex --explain
npx harnessmith restore --agent codex --dry-run
```

Confirm you know where the backups are, which layer `restore` will restore, and what scene to preserve on
failure. The restore preview doesn't modify files.

## Local regression for maintainers

Maintainers can run:

```bash
pnpm run eval:first-value
```

This command regresses preview, install, health, status explain, and restore preview in a disposable
directory, and produces the local acceptance record specified by `evals/first-value-record.schema.json`. It
can only prove the local baseline passes; `hostConfigured`, `hostVerified`, and `firstValueAchieved` should
remain `inconclusive` or `false`. It does not launch, log into, or send telemetry to third-party hosts.

## When it counts as complete

Only when local `installed` and `healthy` both pass, a real host completes the controlled task, work-tree and
tool evidence is reviewable, and the recovery path has been confirmed may the first value be recorded as
`host-verified`. If evidence is missing at any step, keep the current result and state the limitations
clearly; don't substitute stronger wording for verification.
