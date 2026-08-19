# Releasing

Publishing is a maintainer-authorized external write. Never publish only because a version file changed.

## One-time repository setup

1. Create the public source repository and configure `origin`.
2. Add `repository`, `homepage`, and `bugs` URLs to `package.json` using the real public location. Do not use
   placeholder URLs.
3. Enable private security advisories and required CI checks.
4. Configure npm authentication or trusted publishing and require two-factor authentication.

## Release checklist

1. Confirm the working tree contains only intended changes.
2. Update `CHANGELOG.md` and remove the `Unreleased` label for the target version.
3. Keep the npm version and embedded Harness version independent and explain changes to each.
4. Run the strict type check and regenerate both published runtime directories:

   ```bash
   pnpm install --frozen-lockfile --ignore-scripts
   pnpm run release:check
   npm pack --dry-run
   npm publish --dry-run
   pnpm audit --prod --audit-level=high
   pnpm dlx @cyclonedx/cdxgen@12.8.2 -t js --no-install-deps --fail-on-error \
     -o harnessmith-sbom.cdx.json .
   ```

   `npm pack` and `npm publish --dry-run` verify the npm distribution boundary. Dependency installation,
   auditing, and the CycloneDX SBOM run from the frozen pnpm checkout. Verify the generator recognized the
   committed `pnpm-lock.yaml`; keep the SBOM generator version pinned and record it with the release evidence.

5. Install the produced tarball in a temporary home and exercise install, status, restore, uninstall, personal
   overlay initialization, global and project memory, task completion, and multi-Agent rollback.
6. Validate every manual host-evaluation record against `evals/run.schema.json`; an example fixture is not
   release evidence. Preserve only redacted transcripts and evidence artifacts.
7. Verify actual CI runs on every supported operating system and Node.js version. Workflow configuration
   alone is not evidence that the matrix passed.
8. Commit with a Conventional Commit, create a signed version tag, and publish only after explicit maintainer
   approval. Prefer npm provenance when the public repository and publishing workflow are configured.
9. Verify the npm package page, executable, README links, tarball contents, SBOM, provenance statement, and
   clean-room installation.
