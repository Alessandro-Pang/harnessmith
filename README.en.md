# Harnessmith

<p align="center">
  <img src="./docs/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](./README.md) · [Full documentation](https://alexpang.cn/harnessmith/en/)

If you move between several projects and coding agents, the same problems repeat: instructions drift across hosts, project
relationships and progress must be explained again, and growing history cannot all fit safely into model context.

Harnessmith is a local-first, cross-host Personal Harness distribution and work-state control plane. It safely installs one
set of personal instructions, progressive document retrieval, non-authoritative Memory, and Task tools across coding-agent
hosts, with explicit upgrade, recovery, and verification boundaries.

```bash
npx harnessmith
```

## Who it is for

- Developers who use multiple coding agents and want consistent personal instructions.
- Maintainers who need safe upgrades, backups, restore, and uninstall for a personal Harness.
- People who want resumable long-running work without treating memory as project truth.

Harnessmith is not a universal Agent Runtime and does not own model loops, tool permissions, or remote services.

## Start in 30 seconds

Node.js 24.12.0 or newer is required. No global installation is needed.

```bash
# Preview the host, destinations, file states, recovery, and capability boundaries
npx harnessmith setup --agent codex --dry-run

# Reuse the same plan, confirm, install, and run deterministic health checks
npx harnessmith setup --agent codex
```

Add `--yes` explicitly in non-interactive environments. A successful `setup` proves managed-file integrity and embedded
Runtime health; model behavior, tool permissions, and authentication in a real Host session still require separate evidence.

You can also ask a coding agent to read the installation protocol first:

> Read [llms.txt from the npm latest release](https://unpkg.com/harnessmith@latest/llms.txt), install Harnessmith according to that protocol, run dry-run first, and ask me before writing.

## Supported hosts

| Agent | Scope | Selector |
| --- | --- | --- |
| Codex | global | `codex` |
| Cursor | project | `cursor` |
| Claude Code | global | `claude` (alias: `claude-code`) |
| OpenCode | global | `opencode` |
| Kimi Code CLI | global | `kimi` (alias: `kimi-code`) |

Cursor requires `--project /path/to/project`. See the
[host guide](https://alexpang.cn/harnessmith/guide/hosts) for destinations, aliases, and support evidence.

## Common operations

```bash
# Inspect ownership and file integrity
npx harnessmith status --agent codex

# Explain observed state, evidence, risk, and safe actions that are not auto-run
npx harnessmith status --agent codex --explain

# Inventory existing rules without writes, then confirm the exact returned proposalId
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json

# Restore the previous installation layer
npx harnessmith restore --agent codex

# Restore the pre-install state and remove records
npx harnessmith uninstall --agent codex

# Inspect machine-readable Adapter boundaries
npx harnessmith capabilities --json

# Preview a local redacted diagnostics report; the command neither uploads nor persists it
npx harnessmith diagnostics --agent codex --json

# Export the portable personal overlay, then import it through a content-bound proposal
npx harnessmith export --output ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json

# Check cross-repository relationships in your personal Repository Map
node <harness-path>/bin/harness.mjs repository-map check --json

# Check the embedded Runtime after installation
node <harness-path>/bin/harness.mjs health --json
```

See the [CLI reference](https://alexpang.cn/harnessmith/reference/cli) and
[safe lifecycle guide](https://alexpang.cn/harnessmith/guide/lifecycle) for all options and failure handling. The
[Runtime CLI reference](https://alexpang.cn/harnessmith/reference/runtime-cli#repository-map-维护跨项目关系) explains the
Repository Map model, evidence threshold, and maintenance commands.

Installation and local health reach only `installed` / `healthy`; First Value reaches `host-verified` only after the real
Host completes the controlled read-only task with verifier evidence. See the
[First Value Loop](https://alexpang.cn/harnessmith/guide/first-value-loop).

## Embedded document search

`search` / `memory search` use `--mode auto` by default: a valid local full-text index enables weighted BM25 retrieval,
otherwise the commands safely fall back to the existing bounded scan. Only explicit `--refresh-index` atomically builds or
incrementally updates the rebuildable cache under `state/search/`; the cache is not a source of truth. `--mode fulltext`
fails closed when the index is unavailable, while `--mode scan` forces scanning.

## Safety boundaries

| State | Harnessmith's contract |
| --- | --- |
| Implemented | Adapter distribution, preflight, backups, locks, rollback, non-authoritative Memory, Task gates, a privacy-safe `audit record`, and redacted diagnostics previews |
| Delegated to the Host | Model loops, tool/MCP scheduling, sandboxing, approvals, tokens, and cost |
| Unsupported | A universal Runtime, Policy Engine, Pack/Registry, multi-agent orchestration, and automatic rule promotion |

Markdown instructions are guidance, not permission enforcement. The audit and diagnostics schemas reject raw prompt content,
model output, tool arguments, file bodies, environment variables, and secrets; event authenticity still belongs to the host or external attestation. See
[docs/capability-evidence.yaml](./docs/capability-evidence.yaml) for per-capability owners, states, and evidence.

## Learn more

- [Full documentation](https://alexpang.cn/harnessmith/en/) and [getting started](https://alexpang.cn/harnessmith/en/getting-started)
- [Architecture](https://alexpang.cn/harnessmith/architecture), [design principles](https://alexpang.cn/harnessmith/concepts/design-principles), and [boundaries](https://alexpang.cn/harnessmith/concepts/boundaries)
- [Memory and Tasks](https://alexpang.cn/harnessmith/concepts/memory-and-tasks), including Memory Autopilot, and [versions and migrations](https://alexpang.cn/harnessmith/versions/migrations)
- [Project history and influences](https://alexpang.cn/harnessmith/project/history-and-influences) (Chinese canonical page)
- [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [License](./LICENSE)

## Contributing

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

See the [documentation contribution guide](https://alexpang.cn/harnessmith/contributing).
