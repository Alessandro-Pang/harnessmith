# Harnessmith

<p align="center">
  <img src="./apps/docs/site/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](./README.md) · [Full documentation](https://alexpang.cn/harnessmith/en/)

## What problem it solves

Anyone working across several projects and coding agents eventually hits the same wall: your personal rules live in
Codex, Cursor, and Claude Code as separate copies, every change must be synced by hand, and one copy is always stale;
project relationships, progress, and past decisions must be explained from scratch in every new session; and your
growing history of documents cannot all fit into model context, but deleting it means losing the record of how
decisions were made.

Harnessmith packages the fixes into one installable unit: personal rules that already work in practice, on-demand
document retrieval, Memory that never pretends to be fact, and long-running task tools with an acceptance gate.
Install it once across coding-agent hosts, and upgrading, backing up, restoring, and uninstalling all follow explicit
paths — you preview before anything is written, and you can always go back. In one line: Harnessmith is a cross-host Personal Harness distribution and work-state control plane. Everything
runs locally with no cloud service, and Harnessmith does not replace your coding agent: how models reason, how tools
are authorized, and how sandboxes isolate — that stays with the host.

## Who it is for

Developers switching between multiple coding agents who want to maintain their rules once; maintainers who need
safe upgrades, backups, restore, and uninstall for a personal Harness; people who want resumable long-running work
without treating memory as project truth. If you use a single agent and your rules fit in ten lines, a hand-written
`AGENTS.md` is the lighter, correct answer.

```bash
npx harnessmith
```

## Start in 30 seconds

Node.js 24.12.0 or newer is required. No global installation is needed.

```bash
# Step 1: look, don't touch. Preview the host, destinations, recovery, and capability boundaries
npx harnessmith setup --agent codex --dry-run

# Step 2: once the plan looks right, install and run deterministic health checks
npx harnessmith setup --agent codex
```

Add `--yes` explicitly in non-interactive environments. Two things to know up front: a successful `setup` only proves
the managed files and embedded Runtime are usable — model behavior, tool permissions, and authentication in real
sessions need separate verification ("How far is installed" below); and if you already maintain your own rules, run
`adopt` first — it inventories them read-only and produces a proposal you confirm before anything is written.

You can also delegate the install to a coding agent, asking it to read the protocol first:

> Read [llms.txt from the npm latest release](https://unpkg.com/harnessmith@latest/llms.txt), install Harnessmith according to that protocol, run dry-run first, and ask me before writing.

## Supported hosts

| Agent | Scope | Selector |
| --- | --- | --- |
| Codex | global | `codex` |
| Cursor | project | `cursor` |
| Claude Code | global | `claude` (alias: `claude-code`) |
| OpenCode | global | `opencode` |
| Kimi Code CLI | global | `kimi` (alias: `kimi-code`) |
| Zed Agent | global | `zed` |

Global hosts install into the agent's personal config directory and apply to every project; project hosts install
into one project only. Cursor requires `--project /path/to/project`. See the
[host guide](https://alexpang.cn/harnessmith/guide/hosts) for destinations, aliases, and support evidence.

## Common operations

```bash
# Inspect ownership and file integrity
npx harnessmith status --agent codex

# Explain observed state, evidence, risks, and safe next steps that are not run automatically
npx harnessmith status --agent codex --explain

# Inventory existing rules without writing anything
npx harnessmith adopt --agent codex --json

# Confirm the returned proposalId to complete adoption
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json

# Restore the previous installation layer
npx harnessmith restore --agent codex

# Restore the pre-install state and remove installation records
npx harnessmith uninstall --agent codex

# Inspect machine-readable Adapter capability boundaries
npx harnessmith capabilities --json

# Preview a local redacted diagnostics report; the command neither uploads nor persists it
npx harnessmith diagnostics --agent codex --json

# Export the portable personal overlay
npx harnessmith export --output ./harness-config.json --json

# Import on another machine: a content-bound proposal is generated first and applied on confirmation
npx harnessmith import --input ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json
```

Day-to-day capabilities after installation (document search, Memory, Tasks, cross-repository relationships) come from the embedded Runtime:

```bash
# Check cross-repository relationships in your personal Repository Map
node <harness-path>/bin/harness.mjs repository-map check --json

# Check the embedded Runtime itself
node <harness-path>/bin/harness.mjs health --json
```

See the [CLI reference](https://alexpang.cn/harnessmith/reference/cli) for all options, exit codes, and failure
handling, and the [safe lifecycle guide](https://alexpang.cn/harnessmith/guide/lifecycle) for what install,
upgrade, restore, and uninstall each guarantee. The
[Runtime CLI reference](https://alexpang.cn/harnessmith/reference/runtime-cli#repository-map-维护跨项目关系) covers the
Repository Map model, evidence threshold, and maintenance commands.

## How far is "installed"

These three words appear throughout the docs with fixed meanings:

| Stage | Meaning |
| --- | --- |
| `installed` | Files written; preflight and backups passed |
| `healthy` | Deterministic health checks of the embedded Runtime passed |
| `host-verified` | A controlled read-only task completed in a real host, with verifier evidence kept |

The first two come with the install. `host-verified` requires you to confirm the result in a real task — the
installer cannot do it for you; see the [First Value Loop](https://alexpang.cn/harnessmith/guide/first-value-loop).

## After installation

Open a new host session and it reads the rule entry automatically — no prompt pasting. Give it a normal task and the
entry routes to the matching playbook; across sessions, Task records goals and progress while Memory surfaces leads
worth re-checking; at the end, `task verify` records evidence and `complete` is released by the acceptance gate.
`search` / `memory search` use `--mode auto` by default: a valid local full-text index enables weighted BM25
retrieval, otherwise the commands safely fall back to a bounded scan. The index is built atomically or updated
incrementally under `state/search/` only when you pass `--refresh-index` — it is a rebuildable cache, never a source
of truth. `--mode fulltext` fails closed when the index is unavailable, and `--mode scan` forces scanning.

## Safety boundaries

| State | Harnessmith's contract |
| --- | --- |
| Implemented | Adapter distribution, preflight, backups, locks, rollback, non-authoritative Memory, Task gates, privacy-safe audit records, and redacted diagnostics previews |
| Delegated to the Host | Model loops, tool/MCP scheduling, sandboxing, approvals, tokens, and cost |
| Unsupported | A universal Runtime, Policy Engine, Pack/Registry, multi-agent orchestration, and automatic rule promotion |

Two hard lines, stated plainly: Markdown rules are behavioral guidance, not permission enforcement; and audit and
diagnostics schemas reject raw prompts, model output, tool arguments, file bodies, environment variables, and
secrets — event authenticity belongs to the host or external attestation. Per-capability owners, states, and
evidence paths are listed in [capability-evidence.yaml](./apps/docs/site/capability-evidence.yaml).

## Learn more

- [Full documentation](https://alexpang.cn/harnessmith/en/) · [Getting started](https://alexpang.cn/harnessmith/en/getting-started) · [Project history](https://alexpang.cn/harnessmith/concepts/history-and-influences) (Chinese)
- [Architecture](https://alexpang.cn/harnessmith/concepts/architecture) · [Design principles](https://alexpang.cn/harnessmith/concepts/design-principles) · [Boundaries](https://alexpang.cn/harnessmith/concepts/boundaries) (Chinese)
- [Memory and Tasks](https://alexpang.cn/harnessmith/concepts/memory-and-tasks) (Chinese, includes Memory Autopilot) · [Versions and migrations](https://alexpang.cn/harnessmith/reference/migrations) (Chinese)
- [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [License](./LICENSE)

## Contributing

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

See the [documentation contribution guide](https://alexpang.cn/harnessmith/maintain/contributing).
