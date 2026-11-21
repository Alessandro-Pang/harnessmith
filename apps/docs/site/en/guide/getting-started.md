---
title: Getting started
description: The full path from one dry-run command to the first real conversation
owner: maintainers
audience: users
status: active
updated: 2026-11-21
lang: en
---

# Getting started

Complete the first install in three steps: preview → write → verify. This page uses Codex as the example and
explains what each step changes, how refusals are handled, and how to verify a real host after the local install
succeeds.

Harnessmith is an npm initializer; run it directly with `npx` — nothing needs to be installed globally first. The
only environment requirement is Node.js 22.20.0 or newer.

## Before you start

Confirm two things:

- The target coding agent is installed and opens normally. Harnessmith only writes the host's rule entry point; it
  does not install the host for you.
- Decide the install scope: the global personal directory (most hosts) or one specific project (Cursor).

It does not need your model API key and will not log you into any third-party service. If you are worried about
"which of my files exactly will it change", that is precisely the question the first step answers.

## Three steps to install

### Step 1: Preview the plan

Using Codex as the example:

```bash
npx harnessmith setup --agent codex --dry-run
```

Dry-run writes nothing. It outputs the same plan the install will execute: host scope, target roots, per-file
`missing` / `managed` / `unmanaged` / `modified` states, Host capabilities that stay untouched, and recovery commands
for when something goes wrong. Reading this plan before any write is your first confirmation of the change scope;
add `--json` when a machine needs to process it.

### Step 2: Write the install

```bash
npx harnessmith setup --agent codex
```

Interactive mode shows the changes, invariants, and recovery path again before writing, and lets you cancel.
Non-interactive environments (CI, scripts) must confirm explicitly:

```bash
npx harnessmith setup --agent codex --yes --json
```

### Step 3: Verify the result

After the install transaction completes, `setup` automatically checks ownership and embedded Runtime health; you can
also re-check at any time:

```bash
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain
```

Plain `status` only answers "is the install complete". When you need to make a decision based on it, add
`--explain`: it reports observed state, owner, evidence, risk, and a stable action code. These actions are
suggestions only and never execute automatically.

## Two reasons you might be refused

Some write requests are refused by default. This is not a broken install — it is the safety boundary working, and
knowing it in advance saves detours:

- **The target file is not managed by Harnessmith.** The file exists but is `unmanaged`, or was managed and then
  changed into `modified`. The guided flow refuses by default, and the confirmation step cannot bypass it. The right
  move is to understand where the file came from and how it differs; to take it over deliberately, use the explicit
  `adopt` import (see the [lifecycle guide](/en/guide/lifecycle)) and keep the generated backups. Do not use
  `--force` to paper over unknown conflicts: it backs up before replacing, but you own the responsibility for "what
  got overwritten".
- **The host has no Adapter.** A host without an Adapter is `unsupported`; Harnessmith stops before resolving or
  writing any target, leaving no half-install behind.

## If the install fails

Host files are one transaction: on failure, Harnessmith attempts to roll back the exact paths written in this run;
the skill is managed independently by `skills`. Follow the guidance in the error message — re-run the dry-run first,
then check `status`. A committed Host with a failed skill is explicitly marked as partial completion. Use `restore`
only when the current schema 3 record contains recoverable files; it does not chase old installation chains.

## What "installed" actually proves

Two kinds of "pass" appear repeatedly on this page; keep them separate:

- A successful install and passing deterministic health checks only prove the local files and embedded Runtime are
  good;
- Model behavior, tool permissions, authentication, and runtime events are `host-dependent` and must be verified
  separately in a real host session.

The unified vocabulary is `installed`, `healthy`, `host-configured`, `host-verified`: `setup` can prove the first two
locally; `status` only proves `installed` and does not incidentally prove `healthy`. Checks constrained by the
environment explicitly return `inconclusive` instead of inflating "install complete" into "session healthy".

The standard next step after install is:

```bash
npx harnessmith diagnostics --agent <agent> --json
```

Then enter a real host and complete your first controlled task. The full definition of the start, the end, the owner,
failure exits, and the zero-telemetry regression is in the [First Value Loop](/en/guide/first-value-loop).

## Other hosts

`codex`, `claude-code`, `opencode`, `kimi-code`, `zed`, `deepseek`, and `pi` use global install scope; `cursor` uses project scope and
needs an explicit project root:

```bash
npx harnessmith setup --agent cursor --project /path/to/project
```

The same command accepts comma-separated hosts to install several at once:

```bash
npx harnessmith setup --agent codex,opencode,kimi-code
```

Exact paths, aliases, and support status per host: [host support](/en/guide/hosts).

## The first conversation after install

A new host session reads the corresponding rule entry automatically; you do not need to paste the whole rule set
into every request. Start with an ordinary task, for example:

> Analyze this repository's release process read-only. State your sources of truth and what remains unverified; do
> not modify files.

Such a request first hits the trust and discovery rules in the entry point, then routes to the specific playbook on
demand. Harnessmith provides context and a work contract; whether the host executes commands or asks for permission
approval is still the host's decision.

Only when a real host completes that task and keeps tool, filesystem, and verifier evidence do you reach
`host-verified`. Before that, glance at `status --explain` and `restore --dry-run` to confirm the recovery path. That
is the requirement of the `recovery-aware` checkpoint in the First Value Loop.

## Let the agent install it for you

<!-- markdownlint-disable MD034 -->

You can also hand the installation to the coding agent itself, as long as you personally check the targets before
any write:

> Read https://unpkg.com/harnessmith@latest/llms.txt and install Harnessmith according to that protocol; run the
> dry-run first, then let me confirm the write.

<!-- markdownlint-enable MD034 -->
