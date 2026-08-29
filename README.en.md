# Harnessmith

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](./README.md) · [Full documentation](https://alexpang.cn/harnessmith/en/)

Harnessmith is a local-first, cross-host Personal Harness distribution and work-state control plane. It safely installs one
set of personal instructions, progressive context, non-authoritative memory, and task tools across coding-agent hosts.

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
# Choose a host interactively
npx harnessmith

# Select a host; add --dry-run to inspect writes first
npx harnessmith install --agent codex
npx harnessmith --dry-run --agent codex
```

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

# Restore the previous installation layer
npx harnessmith restore --agent codex

# Restore the pre-install state and remove records
npx harnessmith uninstall --agent codex

# Inspect machine-readable Adapter boundaries
npx harnessmith capabilities --json

# Check the embedded Runtime after installation
node <harness-path>/bin/harness.mjs health --json
```

See the [CLI reference](https://alexpang.cn/harnessmith/reference/cli) and
[safe lifecycle guide](https://alexpang.cn/harnessmith/guide/lifecycle) for all options and failure handling.

## Safety boundaries

| State | Harnessmith's contract |
| --- | --- |
| Implemented | Adapter distribution, preflight, backups, locks, rollback, non-authoritative Memory, Task gates, and a privacy-safe `audit record` |
| Delegated to the Host | Model loops, tool/MCP scheduling, sandboxing, approvals, tokens, and cost |
| Unsupported | A universal Runtime, Policy Engine, Pack/Registry, multi-agent orchestration, and automatic rule promotion |

Markdown instructions are guidance, not permission enforcement. The audit schema rejects raw prompt content, model output,
and tool arguments; event authenticity still belongs to the host or external attestation. See
[docs/capability-evidence.yaml](./docs/capability-evidence.yaml) for per-capability owners, states, and evidence.

## Learn more

- [Full documentation](https://alexpang.cn/harnessmith/en/) and [getting started](https://alexpang.cn/harnessmith/en/getting-started)
- [Architecture](https://alexpang.cn/harnessmith/architecture), [design principles](https://alexpang.cn/harnessmith/concepts/design-principles), and [boundaries](https://alexpang.cn/harnessmith/concepts/boundaries)
- [Memory and Tasks](https://alexpang.cn/harnessmith/concepts/memory-and-tasks) and [versions and migrations](https://alexpang.cn/harnessmith/versions/migrations)
- [Memory Autopilot](https://alexpang.cn/harnessmith/concepts/memory-and-tasks) discovery, verification, and privacy boundaries
- [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [License](./LICENSE)

## Contributing

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

See the [documentation contribution guide](https://alexpang.cn/harnessmith/contributing).
