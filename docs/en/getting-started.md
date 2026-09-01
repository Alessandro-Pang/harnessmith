---
title: Getting started
description: Install Harnessmith, select a host, and verify the result
owner: maintainers
lang: en
---

# Getting started

Harnessmith requires Node.js 24.12.0 or newer and does not require a global installation.

Preview the complete first-use plan before writing:

```bash
npx harnessmith setup --agent codex --dry-run
```

The plan reports host scope, destination roots, `missing` / `managed` / `unmanaged` / `modified` file states,
recovery commands, and Host-owned boundaries. Reuse that plan interactively, or confirm explicitly in automation:

```bash
npx harnessmith setup --agent codex
npx harnessmith setup --agent codex --yes --json
npx harnessmith status --agent codex
```

Every interactive step can be cancelled before writing. Setup still refuses unmanaged and modified targets by default;
confirmation does not bypass ownership safeguards. Unsupported hosts stop before destination resolution or writes.

Codex, Claude Code, OpenCode, and Kimi Code CLI use global scope. Cursor uses project scope:

```bash
npx harnessmith setup --agent cursor --project /path/to/project
```

Common recovery operations are:

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

Harnessmith refuses to replace unmanaged or modified files by default. `--force` is an explicit takeover: inspect status and
the dry-run first, then use it only when the backup-and-replace behavior is intended.

After the transactional install, setup verifies ownership and embedded Runtime health. If installation fails, follow the
reported dry-run, status, and restore guidance. A passing deterministic check is not evidence of real Host behavior: models,
tool permissions, authentication, and runtime events remain Host-dependent.

Continue with [host support](/guide/hosts), the [lifecycle guide](/guide/lifecycle), or the full [CLI reference](/reference/cli).
