# Harness behavior evaluations

Unit tests prove deterministic file and CLI behavior. This directory defines a separate contract for
recording a maintainer-observed Codex, Cursor, Claude Code, OpenCode, or Kimi Code CLI run against the installed Harness. The
current release policy requires Codex; Cursor, Claude Code, OpenCode, and Kimi Code CLI records remain supported optional evidence. A schema
fixture, scenario catalog, mocked transcript, or passing unit test is never real host evidence.

## Evidence contract

`scenarios.schema.json` validates the versioned `scenarios.json` catalog, which contains the exact prompt,
setup, observable pass conditions, forbidden conditions, and local regression checks.
`run.schema.json` is the versioned record contract. Every real run uses
`recordType: host-evaluation` and records:

- host product/version and model/model version;
- package version, exact candidate tarball, embedded Harness, complete scenario contract
  (`id`/`prompt`/`setup`/`pass`/`forbidden`), its declared `dependencySha256`, distributed rule
  fingerprints, and the derived
  `behaviorSha256` used for bounded evidence inheritance;
- start and finish timestamps plus `evaluatedAt`, when the maintainer completed evidence review;
- the Host Eval tier, attempt count, elapsed time, termination reason, and enforced scenario/matrix budgets;
- a redacted transcript artifact and SHA-256 digest;
- ordered tool actions, including approval and outcome;
- a filesystem-diff artifact, digest, and changed-path summary;
- one evidence-backed positive assertion for every ordered scenario `pass` condition (`pass-1`, `pass-2`, …);
- one evidence-backed assertion for every ordered scenario `forbidden` condition
  (`forbidden-1`, `forbidden-2`, …);
- a verdict whose references resolve to independently stored evidence artifacts.

Schema v6 makes infrastructure and evaluator failures explicit. `passed` and `behavior-failed` are valid only
for a completed Host execution. Transport failures, scenario budget exhaustion, and an open circuit are
`infra-inconclusive`; evaluator failures are `evaluator-failed`. Infrastructure outcomes never satisfy release
coverage and never become product behavior failures.

Each record is limited to a 15-minute scenario budget and a 60-minute matrix budget. A run may retry once
(`maxAttempts: 2`); the record preserves the attempt count, transport-failure count, and whether execution
completed, exhausted its budget, failed in transport/evaluation, or stopped at an open circuit. This repository
validates those limits and classifications and plans incremental coverage, but does not launch or schedule
third-party Hosts.

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

On failure, human-readable output prints a `Rejected record summary` grouped by root cause and caps inline
audit details; use `eval:gate -- --json` for the complete machine-readable failure. JSON failures use the stable
`EVAL_COVERAGE_INCOMPLETE` code and include the missing matrix cells, rejection counts, grouped reasons, and
all rejected record descriptions.

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
- `dependencySha256` identifies the declared behavior sources that can affect one scenario.

A metadata-only release may inherit fresh passing Host records when the embedded Harness version and that
cell's scenario and dependency fingerprints are unchanged. The global `rulesSha256` remains audit evidence,
but does not invalidate unrelated cells. A changed scenario contract or declared dependency invalidates only that scenario;
unaffected cells remain reusable. SemVer alone never determines reuse.

`pnpm run eval:plan --changed-file PATH` classifies repository changes before real Host execution. L1 keeps
non-behavior changes in deterministic checks only. L2 selects at most three scenarios whose `dependencyPaths`
cover all changed behavior sources. L3 runs the full matrix when a behavior source is unmapped
(`unmapped-behavior-source`) or the L2 selection would exceed that bound. This planner is fail closed: an
unknown behavior file never silently inherits Host evidence.

## Bounded runner contract

`scripts/eval-runner.ts` supplies the transport-neutral scheduling boundary used by a future real-Host
adapter. Independent scenarios run with 2 workers by default and at most 3-way bounded parallelism. Each
transport failure may retry once. Two consecutive transport failures open the circuit breaker, stop new work,
and classify scenarios that never started as `infra-blocked`; they are never converted into behavior failures.

The runner gives every attempt an `AbortSignal` and a hard deadline, enforces both the 15-minute scenario and
60-minute matrix budgets, and preserves `behavior-failed`, `infra-inconclusive`, and `evaluator-failed` as
separate outcomes. An injected executor and clock keep the scheduler deterministic in tests. The runner still
does not authenticate to or launch a third-party Host by itself; concrete Host transport adapters and the RC
drill remain separate work.

Gate output separates `exactArtifactCoverageCount` from `inheritedBehaviorCoverageCount` and lists every
source package version and artifact digest under `inheritedFrom`. Release state and the signed release
attestation also preserve a matrix-cell evidence ledger with `exact`, `inherited`, and `infra-blocked`
entries. Inherited cells bind their source package version and artifact digest. `infra-blocked` never counts
toward passing coverage and is only permitted in an exact, user-authorized risk exception whose uncovered
matrix contains those cells. Historical records whose scenario fingerprint no longer matches may remain in
the evidence directory, but they are not eligible for current coverage. Legacy release state and attestation
schemas remain readable; newly prepared releases write the explicit evidence schema.

The gate intentionally fails when records are absent, stale, `behavior-failed`, `infra-inconclusive`,
`evaluator-failed`, tied to another behavior
contract, or missing any scenario cell for a host required by the checked-in release policy. The
current required host is Codex; Cursor, Claude Code, OpenCode, and Kimi Code CLI can still be validated and retained as optional evidence.
The gate never launches, authenticates to,
or spends money on a third-party host. External host execution and evidence capture remain explicit
maintainer/CI responsibilities.

Passing this gate means only that a complete, fresh **maintainer-attested structure** is internally consistent
and bound to the selected candidate. Local JSON, hashes, and artifacts are forgeable by a repository writer;
the gate cannot prove that a real Host produced the submitted artifacts, that the transcript is complete, or
that the stated verdict is true. Trusted provenance requires an external CI/attestation system and review of
the underlying authorized Host runs.
