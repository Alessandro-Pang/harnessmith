---
title: Migration guide
description: Checks and recovery steps when upgrading Harnessmith, the Runtime, and Memory
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-11-21
lang: en
---

# Migration guide

The current public npm version changes with each release; long-lived documentation does not duplicate current
version numbers. Before upgrading, rely on `npx --yes harnessmith --version` and the release notes.

When upgrading, look at three versions at once: the outer installer, the installed Runtime, and the Memory/Task
data formats. They can change independently; a successful installer upgrade does not mean old Memory has been
migrated, nor that a real Host has verified anything.

## Capture evidence before migrating

```bash
npx --yes harnessmith --version
npx --yes harnessmith status --agent codex --explain --json
npx --yes harnessmith version --json
npx --yes harnessmith memory check /path/to/project --indexed --json
```

Save the JSON above and the current Git/workspace state. Run `setup --dry-run --json` first, confirm the target
files are `managed` with no unexpected `modified` or `unmanaged` entries, then decide whether to write.

## Installer migration

Recommended path:

```bash
npx --yes harnessmith setup --agent codex --dry-run --json
npx --yes harnessmith setup --agent codex --yes --json
npx --yes harnessmith status --agent codex --explain --json
```

### Current layout: one global CLI, skill delegated to `skills`

The complete operational protocol for the current layout (one global CLI, ordinary instruction files, the separate
`skills` transaction, and the package-bundled Runtime) lives in
[llms.txt](https://github.com/Alessandro-Pang/harnessmith/blob/main/llms.txt) shipped with the release; host paths are
in [Host support](/en/guide/hosts) and the layering design in [Architecture](/en/concepts/architecture).

User data defaults to `~/.harnessmith` (`HARNESS_HOME` overrides it). Harnessmith does not create, read, or delete
`~/.agents/harnessmith` or old Runtime copies inside Host directories. Move personal rules and Memory yourself, or
point the environment overrides at their existing locations. Personal overlay initialization (`init personal`) only
creates missing files; the one narrow exception is stale-pointer repair: pre-hub
`~/.agent-harness/projects/repository-map.md` pointers inside existing files are replaced in place with the current
pointer, and no other user content is overwritten.

### Breaking installation-record change

Only `schemaVersion: 3` single-layer, regular-file records are read. Schema 1/2, Hub links, copied Runtime trees, and
multi-layer installation chains are no longer supported: they cannot be upgraded, inspected, restored, or uninstalled
by this version. Old files are not deleted to force adoption.

Back up your own rules and configuration first. To remove an old installation cleanly, use the Harnessmith version that
created it; otherwise identify its managed artifacts and manually move those artifacts and records aside before running
the current `setup --dry-run` and `setup`. Never use `--force` to bypass an unknown record or overwrite files whose
ownership you have not verified.

`restore` now restores only the ordinary-file backups named by the current record. `uninstall` restores the backups
named by the current record and removes the current instruction files and record without traversing older Runtime or Hub layers. User data, state,
and Memory are never deleted by these operations.

Host instruction files and the skills-managed skill are separate transactions. A Host failure attempts Host rollback;
a skill failure after Host commit is explicitly reported as partial completion, not as a rollback or complete install.
Replace commands that hard-code old Hub or per-Host Runtime scripts with the global `harnessmith` command.

Stop at unexpected conflicts. `restore` handles only the current record and cannot recover unknown records or files
that Harnessmith never adopted.

## Runtime and schema migration

The Runtime's `version --json` reports the Harness, Task, and Memory schema versions. After upgrading, run the
read-only checks first:

```bash
npx --yes harnessmith version --json
npx --yes harnessmith doctor
npx --yes harnessmith validate --project /absolute/project/path --json
npx --yes harnessmith memory check /absolute/project/path --indexed --json
```

For unknown schemas, missing owners, or broken references, keep the original directory and output first; do not
edit JSON by hand. Old metadata goes through `memory migrate <scope> <memory>`, which generates a proposal for one
document at a time: `<scope>` is a project path or `global`, `<memory>` is a Memory reference such as
`distilled/<name>`, and `--set` supplies the metadata updates as a JSON object. Apply explicitly with the same
command plus `--apply` only when the report state is `ready` and the targets have been re-verified as unchanged
(the write holds the shared memory lock):

```bash
npx --yes harnessmith memory migrate /absolute/project/path distilled/<memory-name> --set '{"status":"active"}' --json
npx --yes harnessmith memory migrate /absolute/project/path distilled/<memory-name> --set '{"status":"active"}' --apply --json
npx --yes harnessmith memory check /absolute/project/path --indexed --json
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
4. Explicitly apply a single or bounded proposal (`memory migrate` applies one ready migration via the same
   command plus `--apply`);
5. Run `memory check --indexed`, `task status`, and the relevant verifiers again;
6. On failure, keep the original files and the proposal; do not retry against a different target.

`passed` can only mean the current verifier passed; when the environment, host, or external registry cannot be
confirmed, it stays `inconclusive` — it must not be changed to success just to complete the migration.

## Acceptance after migration

Confirm at least:

- The current record, output checksums, and next action from `status --explain` match expectations;
- Runtime `doctor`, `health`, `validate`, and the Memory check pass;
- Task acceptance states were not accidentally closed by the migration;
- Items that require a real Host still complete a Host Eval separately;
- Backups, proposals, and failure scenes are retained or archived according to lifecycle rules.

A successful migration only means the local state finished upgrading; it does not mean model behavior, tool
permissions, authentication, or host behavior has passed real verification.
