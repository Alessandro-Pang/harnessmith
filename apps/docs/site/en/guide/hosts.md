---
title: Host support
description: Install scope, path rules, and the precise meaning of support for six classes of coding agents
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# Host support

This page answers three practical questions: which coding agents Harnessmith can install into, where files
are written, and what "support" actually promises. Pick a host from the table first, then run
`setup --dry-run --json` to see the final paths on your machine; don't guess write locations from default
paths.

Harnessmith currently provides Adapters for six classes of hosts. Think of an Adapter as a translation layer:
it handles path resolution and file-format adaptation so the same personal rules land in the location each
host's conventions expect. It doesn't replace the host's own model loop, tool scheduling, sandbox, or
permission approvals — those remain the host's territory.

Why use Adapters instead of writing files directly? Because every host has different conventions for the rule
entry point: some read a fixed file under the user's home directory, some read the project directory, and some
require a specific frontmatter format. Hardcoding these differences into the distribution template would
couple the template to hosts, and every new host would force a template change. The Adapter pattern separates
what to write (the host-neutral Harness) from where to write it and in what format (host-specific); adding a
host only requires adding an Adapter, without touching the template.

## The six hosts in one table

| Host | `--agent` | Default rule entry point | Scope and activation |
| --- | --- | --- | --- |
| Codex | `codex` | `${CODEX_HOME:-~/.codex}/AGENTS.md` | Global; host default |
| Cursor | `cursor` | `<project>/.cursor/AGENTS.md` and `rules/agent-harness.mdc` | Project; MDC always |
| Claude Code | `claude` (alias `claude-code`) | `${CLAUDE_CONFIG_DIR:-~/.claude}/AGENTS.md` and `CLAUDE.md` | Global; host default |
| OpenCode | `opencode` | `${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/opencode}/AGENTS.md` | Global; host default |
| Kimi Code CLI | `kimi` (alias `kimi-code`) | `${KIMI_CODE_HOME:-~/.kimi-code}/AGENTS.md` | Global; host default |
| Zed Agent | `zed` | `~/.config/zed/AGENTS.md` (Windows: `%APPDATA%\Zed\AGENTS.md`) | Global; host default |

To see the hosts, aliases, and capability scope registered by the current version, run:

```bash
npx harnessmith capabilities --json
```

This command suits scripting or confirming whether a given Adapter exists. What it outputs is the Adapters'
capability declarations; it won't resolve the current project root, environment variables, or file conflicts
for you, and it writes no files. To get the real targets for this install on this machine, run:

```bash
npx harnessmith setup --agent codex --dry-run --json
```

The dry-run output contains the resolved targets, per-file states, conflicts, backups, and recovery hints; it
is the true basis for judging, before installing, where the final changes will land.

## Global hosts and project hosts

The six hosts fall into two install scopes. Global Adapters install personal rules and the Harness Runtime
into the user directory the host's conventions specify; one install then applies to every project. Cursor is
the only exception: it writes to the project root you explicitly authorize, uses the current working directory
when `--project` is omitted, and must be installed again for each different project.

Why does Cursor need special handling? Because its rule-loading mechanism is project-scoped: MDC files under
`.cursor/rules/` travel with the project, not with the user. This means that if you want the same Harness in
multiple projects, you install it once in each project. The good news is that installation is repeatable and
performs a conflict check every time, so forgetting that you already installed won't cause duplicate writes.

In either scope, every path goes through containment and symlink checks before writing, preventing targets
from being redirected by symlinks to unexpected locations. In practical terms: if you or some tool once
linked `~/.codex` somewhere else (such as a sync drive), the installer detects it and stops rather than
writing files to a place you didn't expect.

Next to each entry point you'll also find `agent-harness/` and `.harnessmith/install.json` (Cursor's record
lives in `.cursor/.harnessmith/`). The former is the distributed Harness Runtime; the latter is the install
record — both uninstall and restore depend on it. The install record stores the version, timestamps, the file
manifest, and checksums. With it, `restore` can roll back precisely to the previous layer, and `uninstall`
knows which files to delete and which to leave alone.

Environment variable resolution, target file names, and migration compatibility belong to the outer Adapter;
the distribution template stays host-neutral. To determine the actual target paths on your machine, run
`--dry-run --json` first instead of guessing from the docs. Environment variables and platform differences can
both make the real path differ from the default. A common example: if you set `XDG_CONFIG_HOME`, OpenCode's
rule entry point is not in `~/.config/opencode` but in the location you specified. The dry run lists the
resolved real paths; a glance before installing avoids the confusion of "installed, but can't find the
files".

## Per-host differences and caveats

- **Cursor**: Harnessmith writes only its own managed files into the repository-local Git exclude and
  `.cursor/.ignore`; it never hides or overwrites the team's existing `.cursor/` directory as a whole. When
  you share a repository with a team, it won't interfere with others' configuration. The thinking behind this
  design: the `.cursor/` directory usually already exists and may contain team-shared rules or settings, so
  Harnessmith only adds the files it manages and registers them in the Git exclude, keeping `git status` from
  being flooded with these local files.
- **Kimi Code CLI**: The Adapter targets the current TypeScript/Node.js implementation of Kimi Code CLI and
  uses `KIMI_CODE_HOME`; it does not take over the `~/.kimi/` directory used by the older Python `kimi-cli`.
  If your directory is the old one, first confirm which version you're running. This distinction is an easy
  trap: the two CLI versions can coexist with completely different rule entry points, and installing for the
  wrong version shows up as "installed, but the agent doesn't respond".

For exact compatibility requirements, the `llms.txt` in the corresponding npm release package is
authoritative; it is the freshest contract at each release. If you're reading an offline copy of this
document, or some time has passed since the release, `llms.txt` may contain more recent statements.

## How to interpret "support"

"Support" means the Adapter has implemented the install lifecycle, capability descriptions, and automated
regression; it does not mean every host version has completed a real runtime evaluation. These are two
different layers of commitment — don't conflate them.

Why keep the two layers separate? Because "the installer can write the files in" and "the host really works
as expected" are two different things. The former is entirely under Harnessmith's control and testable:
whether paths are right, formats are right, and conflict checks take effect. The latter depends on the host's
own behavior: whether it reads the rules as agreed, loads them at the right moment, and whether its permission
system works as expected. Harnessmith can state "I wrote according to the host's public contract", but it
cannot promise on the host's behalf that "the host will definitely do so".

Per-item declarations and evidence paths are authoritative in the repository's
[capability-evidence.yaml](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml).
For the limits of real host evaluation and release gates, see
[Evidence and evaluation](/en/concepts/evidence-and-evaluation).
