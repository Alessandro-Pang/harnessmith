# Harness behavior evaluations

Unit tests prove deterministic file and CLI behavior. This directory defines a separate contract for
recording a maintainer-observed Codex, Cursor, Claude Code, or OpenCode run against the installed Harness. The
current release policy requires Codex; Cursor, Claude Code, and OpenCode records remain supported optional evidence. A schema
fixture, scenario catalog, mocked transcript, or passing unit test is never real host evidence.

## Evidence contract

`scenarios.schema.json` validates the versioned `scenarios.json` catalog, which contains the exact prompt,
setup, observable pass conditions, forbidden conditions, and local regression checks.
`run.schema.json` is the versioned record contract. Every real run uses
`recordType: host-evaluation` and records:

- host product/version and model/model version;
- package version, exact candidate tarball, embedded Harness, complete scenario contract
  (`id`/`prompt`/`setup`/`pass`/`forbidden`), distributed rule fingerprints, and the derived
  `behaviorSha256` used for bounded evidence inheritance;
- start and finish timestamps plus `evaluatedAt`, when the maintainer completed evidence review;
- a redacted transcript artifact and SHA-256 digest;
- ordered tool actions, including approval and outcome;
- a filesystem-diff artifact, digest, and changed-path summary;
- one evidence-backed positive assertion for every ordered scenario `pass` condition (`pass-1`, `pass-2`, …);
- one evidence-backed assertion for every ordered scenario `forbidden` condition
  (`forbidden-1`, `forbidden-2`, …);
- a verdict whose references resolve to independently stored evidence artifacts.

All `local:` artifact references are relative to the record file. The validator rejects missing, tampered,
oversized, or path-escaping records and artifacts; bounds record count and aggregate record/evidence bytes;
and applies a high-confidence secret scan to both the raw `run.json` record and every evidence artifact. Raw
credentials, private source, cookies, tokens, and unredacted transcripts must never be preserved.

`run.example.json` is only a schema fixture. Its `recordType: example-only`, placeholder hashes, and notes are
deliberate: copying or renaming it cannot satisfy the validator or release gate.

## Recording a real run

1. Use a disposable repository with no credentials or production access. Build one candidate tarball and keep
   it unchanged while installation, evaluation, and the release command bind their work to its digest:

   ```bash
   npm pack --pack-destination /absolute/path/to/release-candidate
   export HARNESS_RELEASE_ARTIFACT=/absolute/path/to/release-candidate/harnessmith-x.y.z.tgz
   ```

2. Fingerprint that exact tarball and print the expected subject fingerprints:

   ```bash
   pnpm run eval:fingerprint
   ```

   Fingerprinting opens the npm `.tgz`, validates its tar headers, safe `package/` paths, entry types and
   resource limits, and reads package/Harness versions, distributed rules, and scenario contracts from the
   archive itself. It also rejects a stale or spliced candidate when those packaged release contracts differ
   from the current release worktree. Gating fails closed when `HARNESS_RELEASE_ARTIFACT` (or the equivalent
   `--package-artifact PATH`) is absent, invalid, or changed. The exact artifact digest remains the publication
   subject; Host behavior evidence has a separate fingerprint lifecycle described below.
3. Install that exact tarball in the disposable host, then run the unmodified scenario prompt. Capture the
   actual host/model versions, sanitized transcript, ordered tool actions, filesystem diff, forbidden-action
   observations, and verdict.
4. Store each `run.json` beside its redacted artifacts in a local or CI-injected evidence directory. A useful
   ignored local location is `.agent-docs/host-evals/runs`; point the tools at it with
   `HARNESS_EVAL_RUNS_DIR` or `--runs-dir`.
5. Validate the records and then run the release gate:

   ```bash
   export HARNESS_EVAL_RUNS_DIR="$PWD/.agent-docs/host-evals/runs"
   pnpm run eval:validate
   pnpm run eval:gate
   ```

`eval:validate` reads only files named `run.json`; adjacent JSON may be an evidence artifact. It checks schema,
scenario identity, evidence references, containment, artifact digests, and high-confidence secret patterns.
`eval:gate` additionally verifies the exact candidate tarball, then requires compatible
Harness/rule/scenario fingerprints, a passing verdict, every required scenario assertion and forbidden-action
assertion to pass, and a fresh complete required-host × scenario matrix. The default freshness window is 30
days; use `--max-age-days` only when the release policy explicitly chooses another bounded window.

When a host/scenario cell contains multiple valid records, only the record with the latest `evaluatedAt` is
eligible for coverage. A tie at the latest timestamp is ambiguous and fails closed; an older passing record
therefore cannot mask a newer failed or inconclusive evaluation.

The rule fingerprint covers the files that are actually packaged: outer `bin/` and compiled `dist/`, embedded
Harness `bin/` and compiled `dist/`, schemas, `template/AGENTS.md`, routed Harness docs, and generated
personal/project rule templates. The fingerprint output lists package-relative paths read from the candidate;
changing packaged executable behavior invalidates prior host records even if a maintainer forgets to bump a
version string.

## Risk-based inheritance

The artifact and behavior identities intentionally serve different purposes:

- `packageArtifactSha256` identifies the exact npm tarball and changes on every metadata-only release;
- `behaviorSha256` is domain-separated from the artifact digest and covers the distributed executable and rule
  surface represented by `rulesSha256`;
- `scenarioSha256` independently identifies each Host scenario contract.

A metadata-only release may inherit fresh passing Host records when the embedded Harness version,
`rulesSha256`, and that cell's `scenarioSha256` are unchanged. A rule, runtime, template, schema, adapter, or
safety-boundary change alters the rule fingerprint and invalidates the complete matrix. A changed scenario
invalidates only that scenario; unaffected cells remain reusable. SemVer alone never determines reuse.

Gate output separates `exactArtifactCoverageCount` from `inheritedBehaviorCoverageCount` and lists every
source package version and artifact digest under `inheritedFrom`. Release state and the signed release
attestation preserve that inheritance trail. Historical records whose scenario fingerprint no longer matches
may remain in the evidence directory, but they are not eligible for current coverage.

The gate intentionally fails when records are absent, stale, inconclusive, failed, tied to another behavior
contract, or missing any scenario cell for a host required by the checked-in release policy. The
current required host is Codex; Cursor, Claude Code, and OpenCode can still be validated and retained as optional evidence.
The gate never launches, authenticates to,
or spends money on a third-party host. External host execution and evidence capture remain explicit
maintainer/CI responsibilities.

Passing this gate means only that a complete, fresh **maintainer-attested structure** is internally consistent
and bound to the selected candidate. Local JSON, hashes, and artifacts are forgeable by a repository writer;
the gate cannot prove that a real Host produced the submitted artifacts, that the transcript is complete, or
that the stated verdict is true. Trusted provenance requires an external CI/attestation system and review of
the underlying authorized Host runs.
