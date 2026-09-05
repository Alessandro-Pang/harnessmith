---
title: Migration guide
description: Checks and recovery steps when upgrading Harnessmith, the Runtime, and Memory
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Migration guide

The current public npm version changes with each release; long-lived documentation does not duplicate current
version numbers. Before upgrading, rely on `npx harnessmith --version` and the release notes.

When upgrading, look at three versions at once: the outer installer, the installed Runtime, and the Memory/Task
data formats. They can change independently; a successful installer upgrade does not mean old Memory has been
migrated, nor that a real Host has verified anything.

## Capture evidence before migrating

```bash
npx harnessmith --version
npx harnessmith status --agent codex --explain --json
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs memory check /path/to/project --indexed --json
```

Save the JSON above and the current Git/workspace state. Run `setup --dry-run --json` first, confirm the target
files are `managed` with no unexpected `modified` or `unmanaged` entries, then decide whether to write.

## Installer migration

Recommended path:

```bash
npx harnessmith setup --agent codex --dry-run --json
npx harnessmith setup --agent codex --yes --json
npx harnessmith status --agent codex --explain --json
```

If the preview finds conflicts, stop and resolve them first; do not use `--force` to mask unknown content. When
a write fails, recover in this order:

```bash
npx harnessmith status --agent codex --explain
npx harnessmith restore --agent codex
npx harnessmith status --agent codex --explain
```

Use `--force` only when you know exactly which files will be overwritten, where the backups are, and how to roll
back. `restore` can only recover existing install records; it cannot recover files that Harnessmith never
adopted.

## Runtime and schema migration

The Runtime's `version --json` reports the Harness, Task, and Memory schema versions. After upgrading, run the
read-only checks first:

```bash
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs doctor
node <harness-path>/bin/harness.mjs validate --project /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory check /absolute/project/path --indexed --json
```

For unknown schemas, missing owners, or broken references, keep the original directory and output first; do not
edit JSON by hand. Old metadata that can be handled automatically goes through `memory migrate` to generate a
proposal; apply it explicitly only when the proposal state is `ready` and the targets have been re-verified as
unchanged:

```bash
node <harness-path>/bin/harness.mjs memory migrate /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory migrate /absolute/project/path --proposal <proposal-id> --apply --yes --json
node <harness-path>/bin/harness.mjs memory check /absolute/project/path --indexed --json
```

If the current version has no corresponding migration command or the proposal is not `ready`, record the result
as `inconclusive`, keep the original data, and hand it to maintainers.

## Memory and Task data migration

Memory holds leads awaiting verification; it is not a fact database. Migration only changes schema, index, or
lifecycle metadata; it never automatically promotes memories into formal rules or closes Tasks.

Recommended order:

1. Back up or copy `.agent-docs/` and shared Memory;
2. Confirm the current baseline with `memory check --indexed`;
3. Generate the migration proposal and review affected paths, digests, expiration times, and recovery paths;
4. Explicitly apply a single or bounded proposal;
5. Run `memory check --indexed`, `task status`, and the relevant verifiers again;
6. On failure, keep the original files and the proposal; do not retry against a different target.

`passed` can only mean the current verifier passed; when the environment, host, or external registry cannot be
confirmed, it stays `inconclusive` — it must not be changed to success just to complete the migration.

## Acceptance after migration

Confirm at least:

- The content fingerprint from `status --explain` matches expectations;
- Runtime `doctor`, `health`, `validate`, and the Memory check pass;
- Task acceptance states were not accidentally closed by the migration;
- Items that require a real Host still complete a Host Eval separately;
- Backups, proposals, and failure scenes are retained or archived according to lifecycle rules.

A successful migration only means the local state finished upgrading; it does not mean model behavior, tool
permissions, authentication, or host behavior has passed real verification.
