---
title: Temporary resources
description: Ownership and safe-cleanup boundaries for temporary directories, payloads, locks, and diagnostic residue
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Temporary resource lifecycle

Temporary directories, payloads, locks, and failure scenes may contain evidence needed for recovery.
Harnessmith does not delete resources in bulk by name, age, or containing directory; cleanup is allowed only
when the owner, purpose, exact identity, and lifecycle can all be verified.

## Lifecycle and responsibility

| Lifecycle | Cleanup timing | Example |
| --- | --- | --- |
| `process` | When the current process ends | Staging directories for install transactions, syntax-check files |
| `operation` | After the current operation succeeds or fails normally | Temporary data for export and diagnostics |
| `workstream` | After the workstream explicitly ends | Release workspace, Host Eval workspace |
| `retained-for-recovery` | After recovery evidence verification completes | Rollback failure scene snapshots |

A managed workspace contains a `.harnessmith-temp-resource.json` marker. Before cleanup, the marker must be
re-read to verify the owner, purpose, resource identity, active state, and unchanged path. Only the exact
resource the marker points to is deleted — never other files in the same directory.

## How common resources are handled

- `--consume-payload-file` deletes an unchanged payload only after schema, target identity, domain write, and
  result validation all succeed; any failure keeps the original file.
- Installer snapshots, preflight clean rooms, and ordinary operation workspaces are released after success or
  normal failure; a failed rollback keeps the exact paths.
- `.release/`, Host Eval evidence, and recovery snapshots are managed workflow data and must not be handled as
  system temporary files.
- User data lock directories and handoff proofs belong to stable namespaces; active locks, proofs, or
  unknown-digest directories can only be reported, never deleted with wildcards.

## Scanning for residue

```bash
pnpm run temp:scan
```

The scan is a read-only JSON report with the main fields below. Scan results can only provide cleanup leads;
they cannot alone constitute grounds for deletion:

```json
{
  "owner": "harnessmith",
  "lifecycle": "retained-for-recovery",
  "path": "/private/tmp/example",
  "ageSeconds": 3600,
  "active": false,
  "reason": "rollback-failed"
}
```

Actual fields are authoritative from the current CLI output; the example only helps understand the structure and
is not a copyable deletion list. Unknown directories, active locks, recovery-retained paths, and resources with
missing markers should be kept and recorded as `inconclusive`.

There is currently no safe path for a generic `temp:scan --apply` or `rm -rf /tmp/harnessmith-*`. When cleanup
is needed, verify the owner marker, exact path, active state, and SafePath boundaries item by item, then let an
authorized lifecycle flow perform it. Save logs, digests, and the recovery path before deleting.
