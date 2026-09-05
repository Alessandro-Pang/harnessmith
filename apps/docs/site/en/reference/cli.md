---
title: Installer CLI
description: Commands, options, and examples for the Harnessmith outer CLI
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Installer CLI

Harnessmith has two CLIs with different responsibilities: the outer `harnessmith` handles "installing it, and
installing it safely" — host Adapters, install transactions, backups, and restore; the routing, retrieval,
Memory, and Task commands used day to day after installation belong to the embedded Runtime, covered in
[Runtime CLI](/en/reference/runtime-cli). This page covers only the outer CLI.

All commands run via `npx harnessmith <command>`. Start with the full command table, then expand by scenario.

## Command overview

| Command | Purpose | Writes? |
| --- | --- | --- |
| `setup` | Preview, confirm, install, and verify the first Harness | No for a dry run; yes after confirmation |
| `adopt` | Inventory existing Host rules and import them safely | No by default; yes after confirming an exact proposal |
| `harnessmith` / `install` | Install or upgrade the Harness | Yes |
| `status` | Check install ownership and integrity | No |
| `restore` | Restore the previous install layer | Yes |
| `uninstall` | Restore all install layers and remove the record | Yes |
| `capabilities` | Output Adapter scope, activation, and permission boundaries | No |
| `diagnostics` | Preview the local redacted diagnostics report | No |
| `export` | Preview or write a versioned personal overlay bundle | Yes only when `--output` is provided |
| `import` | Validate and plan, or import, a personal overlay bundle | No by default; yes after confirming an exact proposal |

## Common options

| Option | Description |
| --- | --- |
| `-a, --agent <name>` | Target host; repeatable or comma-separated |
| `--project <path>` | Cursor project root; defaults to the current directory |
| `--force` | Back up and replace unmanaged or modified files |
| `--json` | Output machine-readable JSON |
| `-y, --yes` | Disable prompts; defaults to Codex when no host is specified |
| `--dry-run` | Preview targets only; performs no writes |
| `--no-init-global` | Skip shared global Memory initialization |
| `--explain` | For `status` only; explains state, evidence, risk, and a safe next step |
| `--proposal <id>` | For `adopt` and `import`; binds the exact proposal returned by a previous read-only scan |
| `--output <file>` | For `export` only; writes a new bundle file that must not already exist |
| `--input <file>` | For `import` only; reads the local bundle to validate |
| `-v, --version` | Print the version |
| `-h, --help` | Print help |

Two easily misused options deserve separate notes. `--yes` only turns off interaction and selects Codex when no
host is specified; it does not automatically accept file conflicts. `--force` takes over unmanaged or modified
files; before using it, review the dry-run/status output and the backup targets so you know exactly what will be
overwritten.

## First-time configuration: `setup`

`setup` organizes Host selection, target roots, Adapter capability boundaries, file states, expected changes,
invariants, and recovery commands into one shared plan. `--dry-run`, interactive confirmation, and `--json` all
use exactly the same plan structure. What the preview shows is what the write does; a non-interactive real write
requires an explicit `--yes`.

```bash
npx harnessmith setup --agent codex --dry-run --json
npx harnessmith setup --agent codex
npx harnessmith setup --agent cursor --project /path/to/project --yes --json
```

The plan classifies targets as `missing`, `managed`, `unmanaged`, or `modified`, and makes `unsupported` and
`host-dependent` boundaries explicit. The confirmation step does not bypass security policy: `unmanaged` /
`modified` are denied by default, and `--force` may be used explicitly only after reviewing ownership and backup
behavior. A failed install transaction attempts a rollback and gives the dry-run → status → restore recovery
order.

`installed-and-healthy` in the success report only means the deterministic checks for install ownership and the
embedded Runtime passed; model behavior, tool permissions, authentication, or runtime events in a real Host are
not covered. First Value states in the report use the unified vocabulary `installed`, `healthy`,
`host-configured`, `host-verified`: setup can locally prove the first two, while the last two remain
`inconclusive` without real Host evidence. As the next step, run `diagnostics --agent <agent> --json`, then
perform the first read-only controlled task from the documentation; see the
[First Value Loop](/en/guide/first-value-loop) for the complete journey.

## Safe takeover with `adopt`

`adopt` solves a common situation: you already maintain your own AGENTS.md in the host, and you don't want it
overwritten or moved by hand. By default it scans existing Host rules read-only, classifies the content item by
item as managed-compatible, user-owned overlay, conflicting rules, Host-specific configuration, or
non-importable content, and returns the import diff, backup targets, owner, rollback path, and a content-bound
`proposalId`.

```bash
# Step 1: read-only preview
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent cursor --project /path/to/project --json

# After review, confirm explicitly with the proposalId exactly as returned
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json
```

A non-interactive write requires both `--yes` and the exact `--proposal`. If files change after the preview, the
proposal is invalidated and the command stops; secrets, symlinks, unknown formats, out-of-bounds paths, and
modified managed files all fail closed. A confirmed takeover reuses the install transaction's full preflight,
operation locks, exact backups, and rollback, and appends only portable rules to the user-owned personal
overlay; Host frontmatter, managed distribution, mutable state, and project `.agent-docs` never mix into the
overlay. Running it again after success returns only the idempotent `already-adopted`.

## Explainable status: `status --explain`

```bash
npx harnessmith status --agent codex --explain
npx harnessmith status --agent codex --explain --json
```

The explain output uses stable `observedState`, `reasonCode`, and action `code` fields, listing install records,
managed outputs, and backup evidence item by item. Stability means scripts can branch on these fields without
drift across version updates.

`status --json` and `--explain` also return `contentFingerprint`: `recorded` binds the managed content actually
rendered at install time, `current` binds the current content; agreement is `matched`, difference is `drifted`,
and old records or non-adopted targets are `unrecorded`. The computation sorts by logical output role and
restores absolute paths expanded at install time back to placeholders, so equivalent installs of the same
Adapter can be compared across home directories — switching machines won't produce a false drift report.

Local state can be determined as `managed`, `modified`, `unmanaged`, `partial`, or `missing`; `unsupported`
means there is no Adapter contract, and the command stops before path resolution. Harness capability, Host
configuration, and real Host behavior are reported separately; Host conclusions that cannot be proven locally
are fixed as `inconclusive` / `host-dependent` and are never misreported as healthy. Content fingerprints only
prove the content identity of Harnessmith-managed prompts/configuration; they do not prove the Host has loaded
these files, nor model behavior, permissions, or authentication state.

The First Value projection of `status` maps only `managed` to `installed: passed`; because the command does not
run Runtime health, `healthy` remains `not-checked`. The unified next step for a managed state is
`diagnostics --agent <agent> --json`. Suggested actions are shown only as next steps, carrying
`automatic: false`, `destructive: false`, and authorization requirements; `status` never executes them
automatically.

## Redacted diagnostics: `diagnostics`

```bash
npx harnessmith diagnostics --agent codex --json
```

The report contains only allowlisted versions, Adapter capabilities, status codes, counts, SHA-256 digests,
collection budgets, failure classifications, and review commands. Raw prompts, model outputs, tool arguments,
file bodies, environment variables, secrets, user identifiers, and local paths cannot enter the report; unknown
fields are rejected by the schema. The command only previews the report to stdout — it writes no files and
uploads nothing, and you review it before sharing. By default, the decision of "can this be shown to others"
stays in your hands.

Each subcommand reads at most 256 KiB and runs for at most 10 seconds. Over-limit, timeout, no-output, and
invalid-JSON cases are all preserved as stable failure classifications; one successful collection step does not
overwrite earlier failures. Uninitialized project Memory and unperformed real Host behavior are explicitly
marked `inconclusive`.

## Versioned export and import

```bash
# Preview and optionally write a new file; existing output is never overwritten
npx harnessmith export --json
npx harnessmith export --output ./harness-config.json --json

# Step 1 only validates the bundle, digest, and target state, and returns a proposalId
npx harnessmith import --input ./harness-config.json --json

# After review, confirm the exact same bundle and target state
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json
```

The v1 bundle allows only two representations: the personal overlay's `AGENTS.md` and the Repository Map;
managed distribution, mutable state, global/project Memory, Host credentials, caches, temporary files, and
arbitrary workspace content are always excluded. An allowlisted file containing a high-confidence secret or
exceeding 256 KiB does not enter the bundle, and the export is marked `partial`. Better to omit than to
over-include.

`import` fails closed on unknown schemas, unknown fields, digest mismatches, out-of-bounds paths, symlinks, and
invalid UTF-8. A missing target may be created; identical content is skipped idempotently; any differing content
is treated as a conflict that `import` cannot overwrite — go back to the explicit `adopt` flow. The actual write
holds a personal root coordination lock and rolls back to the snapshot on failure; changes to the bundle or
targets after the proposal invalidate the `proposalId`.

## Examples

```bash
# Interactive install
npx harnessmith

# First-time configuration guidance
npx harnessmith setup --agent codex --dry-run
npx harnessmith setup --agent codex

# Preview before a multi-host install
npx harnessmith --dry-run --agent codex,opencode,kimi-code

# Cursor project install
npx harnessmith install --agent cursor --project /path/to/project

# Automation checks
npx harnessmith status --agent codex --json
npx harnessmith status --agent codex --explain --json
npx harnessmith adopt --agent codex --json
npx harnessmith capabilities --json
npx harnessmith diagnostics --agent codex --json
npx harnessmith export --output ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --json

# Rollback lifecycle
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

## Automation output and exit codes

Non-interactive calls should specify `--agent` explicitly and use `--json` when a stable protocol is needed.
JSON failure output is a single stderr object containing `version`, `error.code`, `message`, and `exitCode`.
Scripts can parse it stably without parsing human-readable text.

| Exit code | Meaning |
| ---: | --- |
| 1 | Unclassified internal error |
| 2 | CLI usage error |
| 3 | Security or integrity denial (including conflicts during the adopt/import phases) |
| 4 | Operation lock conflict |
| 5 | No actionable install state (e.g. restore cannot find an install record) |

Command-line arguments are the outer distributor contract. After installation, the embedded Harness CLI has its
own command surface, responsible for docs routing, Memory, Task, repository relationships, and audit; see
[Runtime CLI](/en/reference/runtime-cli) for the full user commands and
[Memory and tasks](/en/concepts/memory-and-tasks) for the design boundaries.
