---
title: Lifecycle
description: Full transaction semantics for install, upgrade, migration, restore, uninstall, and failure handling
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# Lifecycle

This page explains how Harnessmith handles operations that modify local files, and which outcomes can be
confirmed when something fails. Every write first resolves its targets and completes preflight, then proceeds
through staging, backups, and commit; ordinary failures attempt a rollback along the exact paths recorded for
that run. If the rollback itself fails, the system preserves the paths needed for recovery and reports the
result as failed — this situation must not be treated as "already restored".

These safeguards reduce the risk of accidental overwrites and half-finished installs, but they don't mean
system file operations can never fail. Still read the dry run before executing; when you hit a rollback
failure, preserve the scene and follow the exact paths in the output.

## Install and upgrade

```bash
npx harnessmith install --agent codex
```

`install` is the direct command for installing or upgrading; the bare command `npx harnessmith` runs it by
default. When working with a host for the first time, `setup` is recommended instead: it follows a guided
flow of preview → confirm → install → automatic health check, with a chance for manual confirmation at every
step. For the full options of both commands, see the [installer CLI](/en/reference/cli).

Upgrading is simply running install again. When targets don't exist, or still match the previous layer's
install record, takeover is safe; upgrades preserve the mutable `state/`, so your runtime records are not
reset together with the managed templates.

### When files are unmanaged or modified

When a target already exists but isn't managed by Harnessmith (`unmanaged`), or has been changed since coming
under management (`modified`), the default is to refuse the write. `--force` backs up first and then replaces,
but use it explicitly and only after understanding the differences.

If your AGENTS.md already holds rules you've consolidated, don't overwrite it directly. Run `adopt` first to
get a read-only inventory and a content-bound proposal; review the import diff, backups, and rollback path,
then confirm the same `proposalId`:

```bash
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json
```

`adopt` imports only the portable rule body; host-specific configuration stays in the backup of the original
file and is not lost. If the scan or confirmation stage finds a secret, a symlink, an unknown format, an
out-of-bounds path, or a modified managed file, or if the content changed again after the proposal, the flow
stops and waits for you. The actual write shares the same preflight, locks, backups, and transaction rollback
as installation.

## Configuration migration

When switching machines or directories, use `export` / `import` to migrate personal configuration. They
migrate only the user-owned personal overlay — the layer you maintain yourself; they don't copy the managed
Runtime, `state/`, Memory, credentials, caches, or workspace content. The managed parts should be regenerated
by a fresh install on the new machine anyway; only the personal part needs to move.

`export` can first preview on stdout what will move; after confirming, use `--output` to write a new file.
The first run of `import` returns only a conflict plan and a content-bound `proposalId`; commit with
`--proposal <id> --yes` only after review — as with `adopt`, look at the manifest before acting.

One hard boundary: `import` always refuses when the target already has different content. It cannot become an
entry point for silent cross-root merges or overwrites. A personal root lock is held during writes, and
failures roll back to the pre-write snapshot; unknown versions, tampered digests, out-of-bounds paths, and
symlink bundles are all intercepted before writing.

## Read-only preview and status

```bash
npx harnessmith setup --agent codex --dry-run
npx harnessmith status --agent codex --json
```

`setup --dry-run` shows targets without writing; `status` checks ownership and integrity. The compatible
root-command form `npx harnessmith --dry-run --agent codex` still works, but new documentation consistently
uses the explicit `setup`, so readers never have to guess the default action. A failure in a restricted
environment can only mean this check is `inconclusive`; it doesn't automatically imply a broken install —
telling the two apart saves a lot of misjudgment.

## Restore and uninstall

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

`restore` returns to the previous install layer; `uninstall` restores all managed layers and removes the
Harnessmith install record. Both first verify current files, backup relationships, and path boundaries;
neither re-renders templates, nor deletes `.agent-docs` in shared or project locations, nor your maintained
personal overlay. In other words: uninstall clears out what Harnessmith installed; what belongs to you stays.

## Temporary resources

Staging, payload, release, and eval processes produce temporary resources, which their creators should clean
up on both the success and failure paths. To diagnose leftovers, run:

```bash
pnpm run temp:scan
```

For resource owners, retention conditions, and safe-deletion boundaries, see the
[temporary resources lifecycle](/en/reference/temporary-resources).

## Common failures

- **Target already exists and is unmanaged**: look at the dry-run / status output first, confirm where the
  file came from, then decide whether to go through `adopt` or `--force`. Don't delete the original file just
  to make the command pass.
- **Symlink or out-of-bounds path detected**: fix the target root or directory structure; don't bypass the
  fail-closed checks. What they block is exactly the real risk.
- **Node version not met**: upgrade to Node.js 24.12.0 or newer, then run the dry run again.
- **Multi-host operation failed midway**: Harnessmith rolls back along the steps already committed; run
  `status --agent <agent> --explain` again and check the scene Adapter by Adapter.
- **rollback failure**: preserve the recovery path given in the output and don't repeatedly run overwriting
  commands; copy the scene and the backups first, then restore item by item along the paths.
