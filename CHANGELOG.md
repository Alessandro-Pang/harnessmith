# Changelog

All notable changes are documented here. The project follows Semantic Versioning for the npm package.
The embedded Harness schema has its own explicitly recorded version.

## Unreleased

### Changed

- Close the cross-repository relationship-map writeback loop: qualifying stable, verified relationships are
  deduplicated into the personal map, volatile checkout state stays out, and every cross-repository delivery
  reports `updated`, `unchanged`, or `blocked`.

## 0.2.0 - 2026-08-20

### Added

- Initialize and validate a compact current-user profile with evidence levels, stable dimension keys,
  bounded size, and in-place updates when identity, preferences, or technical interests change.

### Changed

- Make `profile.md` the only current user profile inside the Harness; project and host-native memory remain
  historical evidence or recall signals rather than competing current preference stores.
- Restructure the English and Chinese READMEs around product value, quick start, layered capabilities, and
  progressively disclosed automation details.

### Embedded Harness

- Harness runtime advanced from 2.1.0 to 2.2.0. Task and memory schemas remain at version 1; the new profile
  is initialized idempotently and requires no destructive migration.

## 0.1.1 - 2026-08-20

### Fixed

- Declare `write-file-atomic` as a runtime dependency so production-only and `npx` installations can start.
- Render Windows paths safely in distributed YAML and memory frontmatter templates.
- Compare Windows paths semantically in cross-platform tests, including long and 8.3 path forms.

## 0.1.0 - 2026-08-20

### Added

- Codex, Cursor, and Claude Code installation adapters.
- Host-neutral Harness template with progressive documentation, Markdown memory, project inspection,
  validation, and long-running task ledgers.
- LLM-oriented installation guide in `llms.txt`.
- Transactional multi-adapter installation and timestamped backups.
- Installation ownership records with file checksums.
- `status`, `restore`, and `uninstall` lifecycle commands.
- Automatic idempotent global-memory initialization.
- User-owned personal rule and repository-map overlay, preserved across upgrades and uninstall.
- Repository-local ignore handling for managed Cursor files.
- Cross-host install, conflict, recovery, rollback, lifecycle, and template-neutrality tests.
- Commander-based commands and help, plus Clack-based TTY selection, conflict confirmation, and status views.
- Stable `--json` output for scripts and coding agents, isolated from the installation core.
- Strict TypeScript sources and tsup builds for both the installer and the self-contained Harness runtime,
  allowing Commander, YAML, Ajv, and atomic-write libraries
  without requiring a second dependency installation in Agent homes.
- Biome, Commitlint, Vitest, lint-staged, Markdownlint, and Husky quality gates with a shared preflight command.
- Domain preflight checks for CLI contracts, npm package boundaries, Harness documentation routing,
  frontmatter, relative links, template tokens, and host-neutrality.
- Source-level Vitest coverage for the embedded Harness runtime, file/frontmatter/search/project helpers,
  memory initialization and validation, task state transitions, doctor, validate, and CLI dispatch.
- Cross-process task locking, strict task completion routing, richer task schema validation, and archive-aware
  memory search.
- Canonical SafePath checks that reject symlink, junction, and reparse path escapes for managed outputs,
  records, backups, and ignore files, including commit-time TOCTOU revalidation.
- Cross-process Adapter operation locks for install, status, restore, and uninstall.
- Stable structured JSON failures with distinct usage, safety, lock-contention, and internal exit codes.
- Machine-readable Adapter capability and enforcement descriptors in planning, install, and status output.
- Harness `version --json` compatibility output and validation of task and memory schema versions.
- Strict memory metadata, date, lifecycle-link, duplicate-session, and high-confidence secret checks.
- Memory supersede, safe archive, and proposal-only promotion commands; task working memory now expires and
  renews on checkpoint.
- Versioned, redaction-required evidence schema for manual real-host behavior evaluations.

### Changed

- Publish and install only the embedded Harness runtime assets; TypeScript sources remain in the repository.
- Runtime `state/` is preserved but excluded from managed checksums so mutable state does not block upgrades.
- Raise the project and embedded Harness runtime baseline to Node.js 24.12, and run CI exclusively on the
  supported Node.js 24 line.
- Upgrade Node.js type definitions to the Node 24 line, Commander to 15, Commitlint to 21, lint-staged to
  17, markdownlint-cli2 to 0.23, and `write-file-atomic` to 7; retire overrides that pinned the previous
  Commitlint and Markdownlint dependency trees.
- Standardize repository installs, script orchestration, hooks, and CI on pnpm 10.13.0 while retaining npm
  commands only for distribution dry-runs and publication.
- Clarify the registry state, source-checkout workflow, lifecycle-specific safety phases, and
  English/Chinese operational contracts across README, `llms.txt`, architecture, and release documentation.

### Fixed

- Map pending and in-progress task states to the valid `active` working-memory lifecycle so a newly initialized
  task passes `memory check` immediately.

### Safety

- Unmanaged and user-modified files are rejected unless the user explicitly supplies `--force`.
- Multi-Agent restore and uninstall preflight every target and roll back all targets on failure.

### Embedded Harness

- Harness runtime advanced from 2.0.0 to 2.1.0. Task and memory schemas remain at version 1; no migration is
  required or currently exposed.
