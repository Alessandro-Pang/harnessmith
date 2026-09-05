# Harnessmith

<p align="center">
  <img src="./apps/docs/site/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

Harnessmith distributes one host-neutral Personal Agent Harness to several coding-agent hosts and keeps work state available across projects and sessions. You maintain the rules once. Adapters handle host-specific paths, previews, ownership checks, backups, upgrades, restore, and uninstall.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](./README.md) · [Full documentation](https://alexpang.cn/harnessmith/en/)

## What Harnessmith solves

People working across several projects and coding agents see the same drift: rules copied between Codex, Cursor, Claude Code, and other hosts diverge over time. An upgrade can also overwrite files that you still maintain. When a session ends, goals, decisions, and partial results are easy to lose. Loading a growing history of documents into every prompt wastes model context that the current task needs.

Harnessmith keeps those concerns separate:

- one rule source is distributed through host-specific Adapters;
- documents are routed to a task and read when needed;
- Memory keeps sourced leads for later review instead of presenting them as project truth;
- Tasks preserve goals, checkpoints, acceptance conditions, and evidence across sessions;
- install, adopt, upgrade, restore, and uninstall preview their work, check ownership, keep backups, and retain a rollback path.

If you use one agent and your rules fit in a few lines, a hand-written `AGENTS.md` is usually simpler.

## Start in 30 seconds

Node.js 24.12.0 or newer is required. No global installation is needed.

```bash
# 1. Preview destinations, conflicts, backups, and recovery. Nothing is written.
npx harnessmith setup --agent codex --dry-run

# 2. Review the preview, then install and run deterministic health checks.
npx harnessmith setup --agent codex
```

Add `--yes` in non-interactive environments. If you already maintain host rules, run `adopt` first. It inventories existing files without writing and creates a content-bound proposal. Review the proposal, then confirm it with the same `proposalId`; existing files are not overwritten directly.

You can also ask a coding agent to follow the install protocol:

> Read [llms.txt from the npm latest release](https://unpkg.com/harnessmith@latest/llms.txt), install Harnessmith according to that protocol, run dry-run first, and ask me before writing.

## Supported hosts

| Host | Scope | Selector |
| --- | --- | --- |
| Codex | global | `codex` |
| Cursor | project | `cursor` |
| Claude Code | global | `claude` (alias: `claude-code`) |
| OpenCode | global | `opencode` |
| Kimi Code CLI | global | `kimi` (alias: `kimi-code`) |
| Zed Agent | global | `zed` |

A global install writes to the host's personal configuration directory and applies to every project. A project install applies to one project. Cursor accepts `--project /path/to/project`; when omitted, it uses the current working directory. The [host guide](https://alexpang.cn/harnessmith/guide/hosts) lists actual destinations, environment variables, activation behavior, and evidence status.

## Common operations

```bash
# Inspect ownership, file integrity, and safe next steps
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain

# Inventory existing rules without writing; confirm only after review
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json

# Restore the previous layer, or return to the pre-install state
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex

# Inspect Adapter capability boundaries and a local redacted diagnostic report
npx harnessmith capabilities --json
npx harnessmith diagnostics --agent codex --json

# Export a portable personal overlay; create a proposal before importing elsewhere
npx harnessmith export --output ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json
```

The installation result reports the Runtime path. Replace `<harness-path>` with that path to run a health check and inspect the Repository Map:

```bash
node <harness-path>/bin/harness.mjs health --json
node <harness-path>/bin/harness.mjs repository-map check --json
```

In a new host session, the rule entry participates in task routing automatically. For long-running work, use `task checkpoint` to save progress and `task verify` to bind mechanical evidence. Only the acceptance gate allows `task close --status complete`. `search` and `memory search` default to `--mode auto`: they use full-text search when a valid index exists and fall back to a bounded scan otherwise. `--mode fulltext` fails when the index is unavailable; `--mode scan` always scans. The index is written only with explicit `--refresh-index` and remains a rebuildable cache.

See the [CLI reference](https://alexpang.cn/harnessmith/reference/cli) for commands, options, exit codes, and failure handling. The [lifecycle guide](https://alexpang.cn/harnessmith/guide/lifecycle) explains the guarantees for install, upgrade, restore, and uninstall. The [Runtime CLI reference](https://alexpang.cn/harnessmith/reference/runtime-cli#repository-map) covers Memory, Task, search, and Repository Map commands.

## What “installed” means

The documentation uses four states:

| State | What it proves |
| --- | --- |
| `installed` | Managed files were written and the installation record, preflight, and backup relationships are valid |
| `healthy` | Deterministic health checks of the embedded Runtime passed |
| `host-configured` | A real host loaded the rules, authentication, and permission configuration required by its own contract |
| `host-verified` | A real host completed the first controlled task and left reviewable evidence |

The installer can establish only the first two states. The last two require a real host session. Local tests, npm downloads, and GitHub traffic cannot replace host evidence. See the [First Value Loop](https://alexpang.cn/harnessmith/guide/first-value-loop).

## Safety boundaries

| State | Harnessmith's contract |
| --- | --- |
| Implemented | Adapter distribution, path preflight, backups, locks, rollback, non-authoritative Memory, Task acceptance gates, privacy-safe audit records, and redacted diagnostic previews |
| Delegated to the host | Model loops, tool/MCP scheduling, sandboxing, approvals, authentication, tokens, and cost |
| Unsupported | A universal Agent Runtime, Policy Engine, Pack/Registry, multi-agent orchestration, and automatic rule promotion |

Audit and diagnostics emit only schema-allowed metadata. A constrained `audit record` does not contain raw prompts, model output, tool arguments, file bodies, environment variables, or secrets. Whether an event actually occurred remains a host or external-attestation question. Per-capability owners, states, and evidence paths are in `apps/docs/site/capability-evidence.yaml` and its [online copy](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml).

## Learn more

- [Full documentation](https://alexpang.cn/harnessmith/en/) · [Getting started](https://alexpang.cn/harnessmith/en/getting-started) · [Why Harnessmith](https://alexpang.cn/harnessmith/guide/why-harnessmith) (Chinese)
- [Architecture](https://alexpang.cn/harnessmith/concepts/architecture) · [Boundaries](https://alexpang.cn/harnessmith/concepts/boundaries) · [Memory and Tasks](https://alexpang.cn/harnessmith/concepts/memory-and-tasks) (Chinese)
- [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [License](./LICENSE)

## Contributing

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

See the [documentation contribution guide](https://alexpang.cn/harnessmith/maintain/contributing).
