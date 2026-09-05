# Harness behavior evaluations

Unit tests cover deterministic file and CLI behavior. This directory describes how maintainers record an observed run of the installed Harness in Codex, Cursor, Claude Code, OpenCode, Kimi Code CLI, or Zed Agent. Codex is required by the current release policy; records from the other five hosts are optional evidence. A schema fixture, scenario catalog, mock transcript, or passing unit test does not count as Host evidence.

## Before you start

This is a maintainer workflow, not an end-user installation guide. Prepare the following before running it:

- Node.js 24.12.0 or newer and the repository's pinned pnpm version; run `pnpm install --frozen-lockfile`.
- A clean, disposable workspace with an absolute path. Do not use a production checkout or a directory containing credentials.
- A built candidate tarball produced from the exact commit under review. Keep that file unchanged throughout installation, evaluation, and gating.
- For `eval:codex-matrix`, an authenticated local Codex CLI, an explicitly selected model, and permission to run the opt-in Host process. The workflow does not log in, approve access, or create credentials for you.
- A new evidence directory outside the candidate workspace, or an ignored `.agent-docs/host-evals/runs` directory. Never place raw credentials, cookies, private source, or unredacted transcripts in it.

If a Host transport, login, network, model, or disposable workspace is unavailable, record the result as `infra-inconclusive` or `inconclusive`; do not turn missing Host evidence into a passing record.

## Multi-Host capability matrix

`host-capability-matrix.v1.json` maps the current first-startup, read-only analysis, typed-writer,
uninitialized-project, compaction, second-task, sidecar-failure, dirty-worktree, local-write prohibition,
and replay capabilities across all six distribution adapters. `pnpm run eval:host-matrix` binds that
contract and every accepted record to one exact candidate tarball:

```bash
pnpm run eval:host-matrix -- \
  --package-artifact /absolute/path/harnessmith-x.y.z.tgz \
  --runs-dir /absolute/path/to/host-eval-runs
```

The report distinguishes `not-executed`, `unsupported`, `inconclusive`, `infra-inconclusive`,
`evaluator-failed`, and `behavior-failed`. A `passed` cell requires a schema-valid exact-candidate
record, tool actions, filesystem evidence, passing positive and forbidden assertions, and an independent
test/file/log/observation artifact. Missing concrete Host transports or dedicated verifier scenarios remain
explicitly `inconclusive`; installed CLIs, mock evaluators, catalog validation, preflight, and successful
Harness installation never upgrade those cells. The report is bound to one candidate and records a maintainer's observations. It does not prove that a third-party Host performed the run.

## Deterministic Prompt and route benchmark

`pnpm run bench:prompt-route` runs the versioned bilingual corpus in
`prompt-route-corpus.v1.json`. The JSON report includes corpus/input digests, rule and candidate fingerprints,
threshold metrics, per-case false-positive/false-negative audit data, and provenance. A prior JSON report can be
passed with `--baseline-report`; comparison fails unless both reports use the exact same corpus inputs.

This deterministic layer does not manufacture evaluator or Host telemetry. Fact verification, model tokens, and
Host tool calls stay `not-measured` until exact evidence exists, and a passing benchmark is not real Host proof.

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
validates those limits and classifications, plans incremental coverage, and provides an opt-in Codex process
transport plus a first-class full-matrix driver. Nothing runs on import or during unit tests; real Host work
starts only when a maintainer explicitly invokes the driver with an exact candidate digest and model.

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
Harness `bin/` and compiled `dist/`, schemas, `template/AGENTS.md`, routed Harness apps/docs/site, and generated
personal/project rule templates. The fingerprint output lists package-relative paths read from the candidate;
changing packaged executable behavior invalidates prior host records even if a maintainer forgets to bump a
version string.

## Risk-based inheritance

Artifact and behavior identities answer different questions:

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

## Bounded runner and Codex transport contract

`scripts/evaluation/planning/eval-runner.ts` supplies the transport-neutral scheduling boundary used by real-Host adapters.
Independent scenarios run with 2 workers by default and at most 3-way bounded parallelism. Each
transport failure may retry once. Two consecutive transport failures open the circuit breaker, stop new work,
and classify scenarios that never started as `infra-blocked`; they are never converted into behavior failures.

The runner gives every attempt an `AbortSignal` and a hard deadline, enforces both the 15-minute scenario and
60-minute matrix budgets, and preserves `behavior-failed`, `infra-inconclusive`, and `evaluator-failed` as
separate outcomes. An injected executor and clock keep the scheduler deterministic in tests.

`scripts/evaluation/codex/eval-codex-transport.ts` supplies the concrete transport for the current required Host. It invokes
`codex exec` without a shell, sends the scenario prompt over stdin, selects JSONL output, an ephemeral session,
the `workspace-write` sandbox, and automatic approval review, and never uses a dangerous sandbox-bypass flag.
The workspace must be absolute and disposable. The runner `AbortSignal` terminates the process and its
descendants; stdout and stderr are each capped at 1 MiB.

Process launch, cancellation, WebSocket/TLS/network failures become transport failures. Output overflow,
unrecognized non-zero exits, or a crashing evaluator become evaluator failures. An exit code of zero only
produces a bounded capture: an injected behavior evaluator must still return `passed` or `behavior-failed`.
This transport does not persist raw output, construct a `run.json`, authenticate, or start on import. A real RC
drill, sanitized evidence capture, and maintainer review remain explicit later work.

`pnpm run eval:codex-matrix` is the opt-in L3 driver around that transport. It requires the complete 15-scenario
catalog, an absolute candidate tarball and its pre-authorized SHA-256, an explicit Codex model, and a new
evidence directory. Defaults remain policy choices supplied by the caller; the release contract permits 1–3
workers, at most 15 minutes per scenario, at most 60 minutes for the matrix, one transport retry, and at most
1 MiB each for Host stdout and stderr. For example:

```bash
pnpm run eval:codex-matrix -- \
  --package-artifact /absolute/path/harnessmith-x.y.z.tgz \
  --expected-package-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --model gpt-5.6-sol \
  --concurrency 2 \
  --scenario-budget-ms 900000 \
  --matrix-budget-ms 3600000 \
  --max-output-bytes 1048576 \
  --output-dir /absolute/new/path/codex-l3-runs
```

Each attempt installs only the supplied tarball into a disposable fixture, invokes `codex exec` without a
shell, and sends prompts on stdin. The fixture exposes the current `CODEX_HOME/auth.json` by symlink instead
of copying credentials into evidence. Each completed attempt writes schema-v6 sanitized artifacts and an
independently verified verdict; the driver validates all records, runs the exact-candidate gate after a fully
passing matrix, and writes a bounded `matrix-summary.json`. Behavior, infrastructure, evaluator, circuit, and
budget outcomes stay distinct. An incomplete matrix exits non-zero and never becomes release coverage.

Gate output separates `exactArtifactCoverageCount` from `inheritedBehaviorCoverageCount` and lists every
source package version and artifact digest under `inheritedFrom`. Release state and the signed release
attestation also preserve a matrix-cell evidence ledger with `exact`, `inherited`, and `infra-blocked`
entries. Inherited cells bind their source package version and artifact digest. `infra-blocked` never counts
toward passing coverage and is only permitted in an exact, user-authorized risk exception whose uncovered
matrix contains those cells. Historical records whose scenario fingerprint no longer matches may remain in
the evidence directory, but they are not eligible for current coverage. Legacy release state and attestation
schemas remain readable; newly prepared releases write the explicit evidence schema.

The gate fails when records are absent, stale, `behavior-failed`, `infra-inconclusive`,
`evaluator-failed`, tied to another behavior
contract, or missing any scenario cell for a host required by the checked-in release policy. The
current required host is Codex; Cursor, Claude Code, OpenCode, Kimi Code CLI, and Zed Agent can still be validated and retained as optional evidence.
The gate never launches, authenticates to, or spends money on a third-party host. Host execution and evidence
capture remain explicit maintainer/CI responsibilities through the separate matrix driver; merely importing or
testing either module does not create real Host evidence.

A passing gate proves that the complete, fresh maintainer record is internally consistent
and bound to the selected candidate. Local JSON, hashes, and artifacts are forgeable by a repository writer;
the gate cannot prove that a real Host produced the submitted artifacts, that the transcript is complete, or
that the stated verdict is true. Trusted provenance requires an external CI/attestation system and review of
the underlying authorized Host runs.
