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

The entry points in the table are not copies. Every one of them is a symlink to a single shared file,
`~/.agents/harnessmith/entry/AGENTS.md`, and the Harness itself is rendered exactly once into
`~/.agents/harnessmith/skills/agent-harness/` (the whole `~/.agents/harnessmith/` directory is the "hub";
`HARNESS_HOME` overrides its location). The skill follows the
[Agent Skills](https://agentskills.io/specification) layout — `SKILL.md` is the discovery entry point,
`scripts/harness.mjs` the Runtime CLI, `docs/` the task-routed guidance, and `assets/` the templates and
schemas. Codex, OpenCode, Kimi Code CLI, and Zed scan `~/.agents/skills/` natively, so Harnessmith keeps one
managed link there, `~/.agents/skills/agent-harness`; Claude Code and Cursor only scan their own
`skills/` directory, so they additionally receive a `skills/agent-harness` symlink next to their entry point.
Cursor's `.cursor/rules/agent-harness.mdc` is the one rendered copy, because MDC frontmatter cannot be
expressed as a link. The practical consequence: upgrading once updates every installed host, and you can never
end up with two hosts on different Harness versions.

The hub also holds your data, outside the managed skill: `state/` (mutable runtime state such as Task
ledgers and indexes), `rules/` (your personal overlay; `HARNESS_PERSONAL_HOME` overrides it) and `memory/`
(cross-project Memory; `HARNESS_MEMORY_HOME` overrides it). Upgrades never rewrite these, and `uninstall`
never deletes them.

Each host keeps a small install record, `.harnessmith/install.json`, next to its entry point (Cursor's lives in
`.cursor/.harnessmith/`), and the hub keeps its own record listing the hosts that own it. Records store the
version, timestamps, the file manifest, link targets, and checksums. With them, `restore` can roll back precisely
to the previous layer and `uninstall` knows which links to remove and what to leave alone. Because the hub is
shared, lifecycle commands reason about ownership: uninstalling one host only removes its links and drops it from
the hub owners; the hub content is removed when the last owner leaves. `restore` unwinds the hub layer together
with the hosts installed in the same transaction — if you installed `codex,claude` together, restoring only
`codex` is refused with `STATE_CONFLICT` and the message names the agents to include.

Releases before the hub kept a full Harness copy in each host directory as `agent-harness/`, personal rules at
`~/.agent-harness/`, and global Memory at `~/.agent-docs/`. For such a recorded legacy installation, `setup` copies the
user data into `~/.agents/harnessmith/rules` and `memory` (only when those are still empty), renames each old
directory in place to `<name>.backup-<timestamp>`, carries `state/` over to the hub, and writes the moves into the
install records; `restore` moves them back and `uninstall` unwinds the layers. An `agent-harness/` directory
without an install record is treated as user content and is neither moved nor reported.

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
