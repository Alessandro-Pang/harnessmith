---
title: Getting started
description: Install Harnessmith, select a host, and verify the result
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# Getting started

This guide covers a first installation: preview the plan, write to one host, and verify the result. Harnessmith is an
npm initializer, so run it with `npx`; no global install is needed. The only requirement is Node.js 24.12.0 or newer.

The whole process takes about five minutes if you're installing to a single host. The examples below use Codex. Other
hosts use the same three-stage flow, but Cursor is project-scoped and requires `--project`; check the
[host support guide](/guide/hosts) before copying a command.

## Before you start

Two things to confirm:

- Your target coding agent is installed and working. Harnessmith writes its rule entry point, not the host itself.
  If you haven't set up Codex (or whichever host you're targeting) yet, do that first.
- Know whether you want global scope (personal, every project) or project scope (Cursor only). Global means "install
  once, works everywhere"; project means "tied to this specific repository". Most people want global unless they're
  using Cursor.

Harnessmith doesn't need your model API key and won't log you into any third-party service. After the package is
available, its installation and runtime operations use local files: no telemetry and no account creation.

## Three steps to install

### Step 1: Preview the plan

```bash
npx harnessmith setup --agent codex --dry-run
```

Dry-run writes nothing. It outputs the same plan the actual install will use: host scope, target roots, per-file
`missing` / `managed` / `unmanaged` / `modified` states, recovery commands, and Host-owned boundaries. Add `--json`
for machine-readable output.

The preview shows the resolved target paths, including changes caused by environment variables, existing conflicts,
and recovery commands. Nothing is written at this stage.

### Step 2: Write the install

```bash
npx harnessmith setup --agent codex
```

Interactive mode shows the changes, invariants, and recovery path again before writing, and lets you cancel. In
non-interactive environments (CI or scripts), confirm explicitly:

```bash
npx harnessmith setup --agent codex --yes --json
```

The `--yes` flag bypasses the prompt. Review the dry-run output before using it.

### Step 3: Verify

```bash
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain
```

Plain `status` answers "is the install complete?" It checks that managed files exist and match their expected
checksums. Add `--explain` when you need to decide: it reports observed state, owner, evidence, risk, and stable
action codes. Actions are suggestions only — they won't execute automatically. Neither command can prove that a
real host session loaded the rules.

The `--explain` output is for troubleshooting. It records what Harnessmith observed, what it expected, and an action
code for the next step. It does not change files or run the suggested action.

## Two reasons you might be refused

- **Unmanaged or modified files.** The default is denial. If Harnessmith finds files at target locations that it
  didn't create (or that were created but have been modified), it stops rather than overwrite. Inspect with dry-run
  and status first. If you're sure you want to take over, go through `adopt` (see the
  [lifecycle guide](/guide/lifecycle)) or `--force`, but understand what you're overwriting first.
- **Unsupported host.** Harnessmith stops before resolving or writing any targets. No partial installs. If you see
  this error, check the supported hosts list. You may have a typo in the `--agent` value, or you may be trying to
  use a host that isn't yet supported.

## What "installed" actually proves

A passing install means local files and embedded Runtime health check out. It does not prove model behaviour,
tool permissions, authentication, or runtime events — those are host-dependent and require verification in a real
host session. The vocabulary is precise: `installed`, `healthy`, `host-configured`, `host-verified`. Setup proves
the first two locally; the last two remain `inconclusive` without real host evidence.

`installed` is a local file check. `host-verified` requires a real host session that loads the rules and completes a
controlled task. The [First Value Loop](/guide/first-value-loop) describes that additional check.

After install, run:

```bash
npx harnessmith diagnostics --agent <agent> --json
```

Then switch to a real host and complete the first controlled task. The detailed, evidence-based journey is currently
maintained in Chinese: [首次价值循环](/guide/first-value-loop).

## Other hosts

Codex, Claude Code, OpenCode, Kimi Code CLI, and Zed Agent use global scope. Cursor uses project scope:

```bash
npx harnessmith setup --agent cursor --project /path/to/project
```

Multiple hosts at once:

```bash
npx harnessmith setup --agent codex,opencode,kimi-code
```

Exact paths, aliases, and support status: [host support](/guide/hosts).

## Recovery

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

Restore goes back one layer, useful when an upgrade introduced a problem and you want the previous state back.
Uninstall removes all managed layers and the install record. Both validate current files, backup relationships, and
path boundaries before touching anything.

A note on what "removes" means: uninstall deletes the files Harnessmith created, but it doesn't touch files you
created or modified after install. If you edited a managed file, uninstall will warn you and refuse to proceed
unless you explicitly acknowledge the loss. This is deliberate. Silent data loss is worse than an extra
confirmation step.

Continue with the Chinese [host support](/guide/hosts), [lifecycle guide](/guide/lifecycle), or full
[CLI reference](/reference/cli). These pages are the current technical source of truth for host paths and advanced
operations.
