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
   pnpm run preflight
   pnpm run test:coverage
   npm pack --dry-run
   npm pack --pack-destination /absolute/path/to/release-candidate
   pnpm audit --prod --audit-level=high
   pnpm run sbom
   pnpm run sbom:check
   ```

   `npm pack` and `npm publish --dry-run` verify the npm distribution boundary. Dependency installation,
   auditing, and the CycloneDX SBOM run from the frozen pnpm checkout. `sbom` uses the pinned generator and
   records a digest of `package.json` plus `pnpm-lock.yaml`; `sbom:check` and `release:check` reject a stale
   document. Verify the generator recognized the committed lockfile and record it with the release evidence.

5. Bind the release checks to that exact candidate, install the same file in a temporary home, and exercise
   install, status, restore, uninstall, personal overlay initialization, global and project memory, task
   completion, and multi-Agent rollback:

   ```bash
   export HARNESS_RELEASE_ARTIFACT=/absolute/path/to/release-candidate/harnessmith-x.y.z.tgz
   ```

6. Run every scenario in `evals/scenarios.json` against every real host required by the checked-in release
   policy. The current required host is Codex; Cursor and Claude Code remain supported optional evidence.
   Preserve only redacted
   transcripts and local evidence artifacts, set `recordType: host-evaluation`, and bind the records to the
   candidate tarball and complete scenario fingerprints printed by `pnpm run eval:fingerprint`. Record one
   evidence-backed `pass-N` and `forbidden-N` assertion for every corresponding ordered condition. Then run:

   ```bash
   export HARNESS_EVAL_RUNS_DIR="$PWD/.agent-docs/host-evals/runs"
   pnpm run eval:validate
   pnpm run eval:gate
   pnpm run release:publish --dry-run
   ```

   `release:publish` copies `HARNESS_RELEASE_ARTIFACT` to a read-only private snapshot, runs `release:check`
   against that snapshot, verifies its digest did not change, and checks and publishes that same snapshot.
   Publishing an existing tarball does not reliably invoke that tarball's `prepublishOnly`, so the supported
   release workflow performs this gate explicitly; `prepublishOnly` remains a secondary guard for worktree publication.
   `release:check` invokes the same gate and fails when fresh, passing, maintainer-attested real-host records
   are absent from any required-host-by-scenario cell. The result is a **maintainer-attested structure** check: local
   artifacts and digests cannot authenticate their provenance or prove that a real Host behaved as claimed.
   `run.example.json`, schema validation alone, and local unit tests cannot satisfy it; trusted proof requires
   external CI/attestation and evidence review.
7. Verify actual CI runs on every supported operating system and Node.js version. Workflow configuration
   alone is not evidence that the matrix passed.
8. Commit with a Conventional Commit and create a signed version tag only after explicit maintainer approval.
   When trusted publishing or another supported public CI identity is configured, publish the immutable snapshot
   with `pnpm run release:publish --provenance`; otherwise omit `--provenance` and record that no publisher
   attestation was produced. Never infer publishing authorization from a passing gate.
9. Verify the npm package page, executable, README links, tarball contents, SBOM, provenance statement, and
   clean-room installation.
