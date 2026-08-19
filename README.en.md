# Harnessmith

> Forge once. Work consistently across coding agents.

[简体中文](./README.md) | English

Harnessmith is a lightweight npm initializer for an opinionated personal coding-agent Harness.
It installs compact persistent instructions, progressively disclosed operating documents, Markdown memory,
and a durable task ledger for Codex, Cursor, and Claude Code.

> Release status: not yet published to npm. The `npx` commands below apply after the first public release.

```bash
npx harnessmith
```

Node.js 24.12 or newer is required. Source development uses pnpm 10.13.0. Host-specific paths and file
formats live only in installation adapters;
the distributed Harness template has a host-neutral runtime contract.

It distributes and manages a Personal Harness plus local work-state and rule-validation tools. It does not
replace the host Agent Runtime, and Markdown guidance is advisory rather than a security enforcement layer.
See the [architecture and enforcement model](./docs/architecture.md).

## Install and inspect

These registry installation commands are post-publication examples. For the current source checkout, use the
local validation path under Development.

```bash
npx harnessmith install --agent codex
npx harnessmith install --agent cursor --project /absolute/path/to/repository
npx harnessmith --agent all --project . --dry-run
npx harnessmith --agent all --project . --dry-run --json
npx harnessmith status --agent all --project .
```

Existing unmanaged or user-modified files are rejected by default. Use `--force` only after reviewing the
dry-run output; Harnessmith backs up replaced files before taking ownership. Interactive terminals get
multi-select and explicit conflict confirmation; scripts and LLMs should use `--json` for stable output.
`--yes` disables prompts but never authorizes file conflicts. A user-owned personal overlay at
`~/.agent-harness` is always initialized without overwriting existing files. Global Markdown memory is
initialized automatically unless `--no-init-global` is supplied; that flag does not skip the personal overlay.

`--json` covers both success and failure. Failures emit exactly one stderr JSON object containing a stable
error code and exit code: CLI usage is 2, safety or integrity refusal is 3, operation-lock contention is 4,
missing actionable installation state is 5, and an unclassified internal error is 1.

## Recover or uninstall

```bash
# Restore the previous installation layer.
npx harnessmith restore --agent codex

# Restore every recorded layer and return to the pre-install state.
npx harnessmith uninstall --agent codex
```

Both commands stop when managed files have been modified. `--force` explicitly allows recovery to replace
those modifications. Shared and project `.agent-docs` memory and the personal overlay are never removed by
uninstall.

Cursor installations are project-scoped. Harnesssmith adds only its managed files to the repository-local
Git exclude file and `.cursor/.ignore`; existing team rules under `.cursor/` remain visible and untouched.

Supported overrides are `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `HARNESS_MEMORY_HOME`,
`HARNESS_PERSONAL_HOME`, `HARNESS_REPOSITORY_ROOT`, and `HARNESS_OWNER`. Host-specific variables stay in
their installation adapters and never enter the portable Harness runtime contract.

Install stages and syntax-checks the complete rendered target before replacement. Restore and uninstall
instead preflight exact paths from installation records. All lifecycle operations use per-Adapter locks,
canonical containment checks, and rollback; unknown or modified targets fail closed unless the user explicitly
authorizes `--force`.

## Harness capabilities

- Compact always-loaded instructions with task-specific documentation routes.
- Strict separation between rules, authoritative project facts, and non-authoritative memory.
- A user-owned personal rule and repository-map overlay, preserved across upgrades and uninstall.
- Idempotent global and project memory initialization.
- Memory list, search, strict metadata/reference validation, supersede, safe archive, and proposal-only
  promotion into authoritative project documentation.
- Long-running task objectives, checkpoints, acceptance evidence, and completion gates.
- Project inspection, doctor checks, and structured validation reports.
- Transactional multi-host installation with checksums, backups, restore, and uninstall.
- Canonical path containment that rejects symlink, junction, and reparse segments below the authorized root.
- Cross-process Adapter operation locks for install, status, restore, and uninstall.
- Machine-readable Adapter capabilities that distinguish scope, format, activation, advisory guidance, and
  host-owned permissions.

The current source version is the unreleased `0.1.0`; future `0.x` releases are intended for public Alpha/Beta
validation. See [CONTRIBUTING.md](./CONTRIBUTING.md),
[SECURITY.md](./SECURITY.md), and [CHANGELOG.md](./CHANGELOG.md).

## Development

Both the installer and the embedded Harness use strict TypeScript. `pnpm run build` compiles the installer to
the root `dist/` directory and bundles the embedded runtime to
`template/agent-harness/dist/harness.mjs`. Both directories are generated; do not edit them directly. The npm
package and user installations contain only the embedded runtime, docs, templates, and schemas; TypeScript
sources remain in the source repository.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node bin/harnessmith.mjs --help
pnpm run format
pnpm run preflight
pnpm run test:harness
pnpm run test:coverage
npm pack --dry-run
```

`npm pack --dry-run` intentionally verifies the npm distribution manifest; dependency installation, script
orchestration, hooks, and CI use pnpm.

Biome, Markdownlint, Commitlint, Vitest, lint-staged, and Husky provide a single quality gate. The Git hooks
check staged files, Conventional Commit messages, and the full preflight before push. CI runs preflight and a
separate coverage gate; npm publication runs `pnpm run release:check`.
