---
title: Getting started
description: Install Harnessmith, select a host, and verify the result
owner: maintainers
lang: en
---

# Getting started

Harnessmith requires Node.js 24.12.0 or newer and does not require a global installation.

Start interactively:

```bash
npx harnessmith
```

Or select a host explicitly and inspect the plan before writing:

```bash
npx harnessmith --dry-run --agent codex
npx harnessmith install --agent codex
npx harnessmith status --agent codex
```

Codex, Claude Code, OpenCode, Kimi Code CLI, DeepSeek Harness, and Pi Agent use global scope. Cursor uses project scope:

```bash
npx harnessmith install --agent cursor --project /path/to/project
```

Common recovery operations are:

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

Harnessmith refuses to replace unmanaged or modified files by default. `--force` is an explicit takeover: inspect status and
the dry-run first, then use it only when the backup-and-replace behavior is intended.

Continue with [host support](/guide/hosts), the [lifecycle guide](/guide/lifecycle), or the full [CLI reference](/reference/cli).
