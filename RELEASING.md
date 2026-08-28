# Releasing

Publishing is a maintainer-authorized external write. Never publish only because a version file changed.

## One-time repository setup

1. Create the public source repository and configure `origin`.
2. Add `repository`, `homepage`, and `bugs` URLs to `package.json` using the real public location. Do not use
   placeholder URLs.
3. Enable private security advisories and required CI checks.
4. Configure npm Trusted Publishing for GitHub Actions with owner `Alessandro-Pang`, repository
   `harnessmith`, workflow `publish.yml`, environment `npm`, and the `npm publish` action. Protect the
   `npm` GitHub Environment and release tags with the repository rules appropriate for maintainers.

## Tag-triggered release

1. Commit all product changes first, leave release notes under `## Unreleased`, check out `main`, and start
   the local version transaction with one of:

   ```bash
   npm run release -- patch
   npm run release -- minor
   npm run release -- major
   ```

   This requires a clean `main`, calls `npm version` without creating a commit or tag, promotes the
   `Unreleased` changelog section, runs preflight, and writes the exact reproducible npm
   candidate under ignored `.release/` state. A failure restores the versioned source files instead of leaving
   a half-bumped release.

2. Bind the release checks to the printed candidate, install the same file in a temporary home, and exercise
   install, status, restore, uninstall, personal overlay initialization, global and project memory, task
   completion, and multi-Agent rollback:

   ```bash
   export HARNESS_RELEASE_ARTIFACT=/absolute/path/to/release-candidate/harnessmith-x.y.z.tgz
   ```

3. For a changed behavior fingerprint, run every affected scenario in `evals/scenarios.json` against every
   real host required by the checked-in release policy. The current required host is Codex; Cursor, Claude
   Code, and OpenCode remain supported optional evidence. A rules/runtime/safety-boundary change invalidates the complete
   matrix; a scenario-only change invalidates that scenario. A metadata-only release may reuse fresh compatible
   records. Preserve only redacted
   transcripts and local evidence artifacts, set `recordType: host-evaluation`, and bind the records to the
   candidate tarball and complete scenario fingerprints printed by `pnpm run eval:fingerprint`. Record one
   evidence-backed `pass-N` and `forbidden-N` assertion for every corresponding ordered condition. Then run:

   ```bash
   export HARNESS_EVAL_RUNS_DIR="$PWD/.agent-docs/host-evals/runs"
   pnpm run eval:validate
   pnpm run eval:gate
   pnpm run release:prepare
   npm run release -- finalize
   ```

   `release:prepare` copies `HARNESS_RELEASE_ARTIFACT` to a read-only private snapshot under ignored local
   `.release/` state, runs `release:check` against that exact candidate tarball, and preserves the verified
   artifact digest, behavior fingerprint, and compact Host matrix summary. An explicit `--package-artifact` or
   `HARNESS_RELEASE_ARTIFACT` replaces any older prepared state; only a run without either setting resumes the
   existing snapshot. When compatible evidence is reused, the state records a Host Eval inheritance source
   version and artifact digest. `finalize` verifies that state,
   writes the bounded `release-attestation.json`, creates a
   Conventional Commit, and creates a signed `vX.Y.Z` tag. It does not push or publish.
   `release:check` invokes the same gate and fails when fresh, passing, maintainer-attested real-host records
   with compatible behavior are absent from any required-host-by-scenario cell. The result is a
   **maintainer-attested structure** check: local
   artifacts and digests cannot authenticate their provenance or prove that a real Host behaved as claimed.
   `run.example.json`, schema validation alone, and local unit tests cannot satisfy it; trusted proof requires
   external CI/attestation and evidence review.
4. Review the release commit and tag locally, then push the exact pair only with explicit authorization:

   ```bash
   git push --atomic origin main refs/tags/vX.Y.Z
   ```

5. `.github/workflows/publish.yml` triggers only on version tags. It verifies GitHub's signed-tag result,
   requires the tag commit to be reachable from `origin/main`, rebuilds the deterministic candidate, compares
   it to the committed attestation, and publishes that exact file through npm Trusted Publishing. The workflow
   has `id-token: write`, no npm token, and uses the protected `npm` Environment. GitHub OIDC publication of
   this public package produces provenance automatically.
6. Verify actual CI runs on every supported operating system and Node.js version. Workflow configuration
   alone is not evidence that the matrix passed.
7. Verify the npm package page, executable, README links, tarball contents, provenance statement, and
   clean-room installation.

The committed attestation is intentionally a small maintainer assertion, not raw Host evidence. Redacted
transcripts remain outside Git history. The signed tag and candidate digest make the assertion tamper-evident,
but they cannot independently prove that a third-party Host produced the reviewed artifacts.

## Local fallback

If Trusted Publishing is unavailable, `pnpm run release:publish` still resumes the prepared local snapshot after
an authentication failure and does not rerun the release checks. Direct worktree `npm publish` remains blocked.
The fallback is not the normal release path and does not replace registry clean-room verification.
