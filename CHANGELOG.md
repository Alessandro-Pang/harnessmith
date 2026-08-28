# Changelog

All notable changes are documented here. The project follows Semantic Versioning for the npm package.
The embedded Harness schema has its own explicitly recorded version.

## Unreleased

### Removed

- Remove the repository-maintained SBOM artifact, generator, tests, and release freshness gate; GitHub's
  dependency graph continues to derive npm dependency data from the committed manifest and pnpm lockfile.

## 0.6.0 - 2026-08-26

### Added

- Add typed Memory Autopilot commands for payload-file important-input capture, indexed recovery snapshots and
  close lifecycle, plus canonical profile reconcile, forget, pause, and resume controls.
- Add a concrete, reproducible multi-turn Host Eval scenario contract for proactive persistence without memory
  language in the task prompt; a real Host pass still requires a separately recorded and validated run.
- Make handoff snapshots preserve omitted facts, decisions, verification, open issues, scope, and source references;
  explicit clear options remove stale fields without accumulating a transcript.

### Changed

- Allow initialized local memory sidecars to be maintained quietly within a narrow boundary while keeping
  source, formal documentation, remote writes, and uninitialized read-only projects outside implicit scope.
- Repair the canonical profile route during global-memory initialization and exclude local Host Eval artifacts
  from project-memory validation and secret-scan budgets; `eval:validate` remains their separate gate.
- Make an explicit release candidate override stale prepared release state while preserving artifact-less publish
  resume after an interrupted registry attempt.
- Reject root-internal symlink escapes before any coordinated write, update exact memory references without
  prefix collisions, and deduplicate inputs across dates and titles by full semantic digest.

### Fixed

- Keep task ledgers created under the earlier lexical ID contract readable after portable IDs become mandatory
  for new tasks, without reopening unsafe path separators or leading characters.

### Embedded Harness

- Harness runtime advances from 2.4.0 to 2.5.0. Task schema remains at 3 and memory schema remains at 1.

## 0.5.1 - 2026-08-25

### Changed

- Reuse fresh Host Eval evidence across metadata-only releases when behavior and scenario fingerprints remain
  identical, while preserving exact candidate attestation and scoped invalidation.

## 0.5.0 - 2026-08-24

### Added

- Add a schema-backed personal repository-map lifecycle with deterministic Markdown rendering, evidence
  verification, staleness and size maintenance, trusted package discovery, proposal-first reconciliation,
  and validated legacy migration.
- Add `repository-map check`, `render`, `verify`, `maintain`, `discover packages`, `reconcile`, and `migrate`
  commands with JSON contracts, coordinated locks, and atomic writes.

### Changed

- Store repository descriptions, ownership, aliases, remotes, and direct provider-to-consumer relations in a
  canonical YAML source while keeping generated views and mutable verification state separate.
- Preserve the canonical repository map across outer installer snapshots and initialize it idempotently for
  new personal Harness installations.

### Embedded Harness

- Harness runtime remains at 2.4.0. Task schema remains at 3 and memory schema remains at 1; repository-map
  schema version 1 is introduced without changing those compatibility contracts.

## 0.4.1 - 2026-08-24

### Changed

- Persist stable, verified cross-repository relationships to the personal repository map by default while
  preserving explicit user prohibitions and excluding volatile checkout or deployment state.

### Fixed

- Restore the established human-facing `Harnessmith` brand spelling while retaining the published
  `harnessmith` package identifier and command name.

## 0.4.0 - 2026-08-24

### Added

- Add an SBOM generation command and a source-input freshness gate to the supported release workflow.
- Report duplicate active-memory titles and supersession cycles as read-only maintenance signals.
- Add provenance-carrying Harness search with independent result, depth, file-count, per-file, and total-byte
  budgets plus observable scan truncation; add read-only route/explain/capability discovery and a fail-closed
  health report that verifies managed runtime identity and installed checksums.
- Add proposal-first memory migration, lifecycle maintenance, canonical cross-process memory locks, and
  indexed reachability plus secret-pattern validation.
- Add `task verify` for Harness-produced command, test, file, and diff evidence with explicit freshness scopes.
- Add a v4 maintainer-attested Host Eval contract and release gate covering every scenario for the checked-in
  required-host policy, bound to the exact candidate tarball and complete scenario contract, with required
  pass and forbidden assertions and all-artifact secret scanning. The 0.4.0 policy requires Codex while
  retaining Cursor and Claude Code as supported optional evidence.

### Changed

- Reject caller-selected `task accept --status passed` immediately in favor of `task verify`, and expose stale
  mechanical acceptance evidence as a derived task-status field without mutating the ledger.
- Bind Cursor Git discovery to the requested project and canonical Git common directory, ignore ambient Git
  repository redirection, and canonicalize user-data roots across locks, snapshots, and initialization writes.
- Use one human-facing Harnessmith brand spelling while retaining the published `harnessmith` package identifier.
- Make lifecycle dry-runs read-only plans, preflight every multi-Adapter change before mutation, and preserve
  recovery snapshots when rollback itself is incomplete.
- Reduce permanent prompt content to high-loss boundaries and route detailed procedures through compact docs.
- Coordinate outer snapshots, embedded initialization, Memory mutations, and Task writes on canonical
  per-user lock targets; release every acquired lock while preserving the primary operation failure.

### Embedded Harness

- Harness runtime advances from 2.3.0 to 2.4.0. Task schema advances from 1 to 3; legacy caller-reported
  evidence cannot satisfy completion and active historical `passed` criteria require `task verify` again.
  Memory schema remains at version 1.

## 0.3.0 - 2026-08-21

### Changed

- Close the cross-repository relationship-map writeback loop: qualifying stable, verified relationships are
  deduplicated into the personal map, volatile checkout state stays out, and every cross-repository delivery
  reports `updated`, `unchanged`, or `blocked`.
- Close project-memory recall and experience loops with indexed reachability checks, read-only maintenance
  reports, automatic task-to-core routing, explicit delivery outcomes, and verified formal-promotion steps.

### Embedded Harness

- Harness runtime advanced from 2.2.0 to 2.3.0. Task and memory schemas remain at version 1; existing memory
  stays compatible, while `memory check --indexed` and `memory maintain` add stricter optional operations.

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
