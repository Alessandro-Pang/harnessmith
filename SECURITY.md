# Security Policy

## Supported versions

The latest published `0.x` version receives security fixes during the Alpha/Beta period. The currently
supported version is `0.1.0`.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could overwrite user files, escape an intended path,
execute untrusted content, disclose local paths or memory, or weaken installation recovery. Use the hosting
repository's private security-advisory channel. If the repository does not yet provide one, contact the
maintainer privately before publishing details.

Include the affected version, operating system, exact command, resolved destinations, and a minimal
reproduction without secrets or personal memory content.

## Security boundaries

- Harnessmith never requires `sudo`.
- Existing unmanaged or modified files require explicit `--force` before replacement.
- Managed outputs, backups, records, and ignore files must remain within their authorized canonical roots.
  Existing symlink, junction, and reparse segments below those roots are rejected by default.
- Install, status, restore, and uninstall serialize each Adapter through a cross-process operation lock. Do
  not delete a live lock to force progress.
- Backups and installation records remain local.
- Uninstall does not delete shared or project `.agent-docs` memory.
- A future custom-template feature must treat templates as executable trusted input because installed
  Harness JavaScript can run with the user's permissions.

Path checks reduce symlink and TOCTOU risk but cannot provide a cross-platform kernel-level `openat`/
`O_NOFOLLOW` transaction in Node.js. The implementation therefore combines canonical roots, `lstat` segment
checks, operation locks, commit-time full revalidation, and per-mutation revalidation. Report any reproducible
race that still changes a path outside the selected Adapter home or project as a security vulnerability.
