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

This page walks you through your first Harnessmith installation: preview the plan, write to one host, then verify.
Harnessmith is an npm initializer — run it with `npx`, no global install needed. The only requirement is Node.js
24.12.0 or newer.

The whole process takes about five minutes if you're installing to a single host. The examples below use Codex, but
the steps are identical for other hosts — just change the `--agent` value.

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

Previewing first gives you a chance to see exactly what will happen before anything touches your disk. You'll
see the resolved target paths (which may differ from defaults if you have environment variables set), any existing
files that would conflict, and the commands to recover if something goes wrong. Thirty seconds of reading the output
can save you from surprises later.

### Step 2: Write the install

```bash
npx harnessmith setup --agent codex
```

Interactive mode shows the changes, invariants, and recovery path again before writing, and lets you cancel. This
second confirmation exists because dry-run output can be long. If you skimmed past something important, here's your
chance to catch it.

Non-interactive environments (CI, scripts) must confirm explicitly:

```bash
npx harnessmith setup --agent codex --yes --json
```

The `--yes` flag bypasses the interactive prompt. Use it only when you've already reviewed the plan via dry-run.

### Step 3: Verify

```bash
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain
```

Plain `status` answers "is the install complete?" It checks that managed files exist and match their expected
checksums. Add `--explain` when you need to decide: it reports observed state, owner, evidence, risk, and stable
action codes. Actions are suggestions only — they won't execute automatically.

The `--explain` output is designed for troubleshooting. If something looks wrong, it tells you what Harnessmith
observed, what it expected, and what you might do next. It won't fix things for you, but it gives you the information
to fix them yourself.

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

This distinction matters because "installed" is easy to verify mechanically, while "working in my host" is not.
Harnessmith could claim success after writing files, but that would be misleading. The real test is whether your
coding agent loads the rules and behaves as expected. That test requires you to actually use the host, which is why
the [First Value Loop](/guide/first-value-loop) exists.

After install, run:

```bash
npx harnessmith diagnostics --agent <agent> --json
```

Then switch to a real host and complete the first controlled task. Full journey: [First Value Loop](/guide/first-value-loop).

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

Continue with [host support](/guide/hosts), the [lifecycle guide](/guide/lifecycle), or the full
[CLI reference](/reference/cli).
