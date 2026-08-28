# Temporary Resource Lifecycle

Harnesssmith only removes temporary resources that carry a verifiable owner or belong to the exact
user-data coordination namespace. A shared prefix such as `harnessmith-*` is never deletion authority.

## Lifecycle contract

Every managed workspace records a private `.harnessmith-temp-resource.json` marker with its `owner`,
`purpose`, creation time, creating process, unique resource identity, and one lifecycle:

| Lifecycle | Ownership and disposal |
| --- | --- |
| `process` | Exists only while one process is alive. |
| `operation` | Removed by the operation disposer on success and ordinary failure. |
| `workstream` | Kept across related operations until that workstream explicitly closes it. |
| `retained-for-recovery` | Kept only when a diagnosed failure needs exact recovery evidence. |

`withTemporaryWorkspace` is the default for process and operation workspaces. Cleanup validates the
directory identity and unchanged marker before removing the exact path. An operation error remains the
primary error; incomplete cleanup adds the retained path. Failure retention must be explicit and reports
both the reason and exact path.

## Resource mapping

- Memory, profile, handoff, experience, and audit JSON payloads are operation-scoped. Callers pass
  `--consume-payload-file`; the Harness deletes the unchanged file only after schema, domain write, and
  managed-result validation all succeed. Any earlier failure retains that exact payload for diagnosis.
- Installer snapshots and preflight clean rooms use the shared temporary workspace implementation.
  Successful runs and ordinary failures dispose them; rollback failures retain exact recovery paths.
- Prepared package tarballs and release state under `.release/` are workstream resources, not anonymous
  OS temporary files. Host Eval evidence belongs under `.agent-docs/host-evals/` and is retained evidence.
- Ad-hoc registry, npm-cache, coverage, Host Eval, and clean-room directories should be created through
  the shared workspace helper. Evidence that must survive is moved to the managed release/evidence roots.
- The user-data lock namespace is stable. Per-root `.lock` directories and sibling handoff proofs are
  process resources; old empty digest directories are reportable maintenance candidates, never globbed.

## Historical maintenance

Run `pnpm run temp:scan` for a bounded JSON dry-run. The report lists only valid managed markers and exact
64-hex digest directories inside a user-data lock namespace, including owner, lifecycle, age, size, and
activity. It does not delete anything. Unknown directories, active locks/proofs, and recovery-retained
paths are never inferred safe from a name or age.

This release intentionally provides no apply mode. Historical deletion requires a separate, explicit
workflow that revalidates the owner marker, exact path, activity, and SafePath boundary item by item.
