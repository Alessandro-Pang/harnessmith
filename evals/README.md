# Harness behavior evaluations

## Codex evaluation suite

The Codex suite is the single public evaluation entrypoint. It runs the deterministic route
benchmark, the behavior, state-based Memory, and reasoning-mode cases against the same
candidate tarball and writes one `suite-summary.json`; each family is only a fixture/verifier adapter inside that scheduler. Memory evaluation verifies durable state separately
from response quality inside that suite. The versioned catalog in
[`evals/memory/scenarios.v1.json`](memory/scenarios.v1.json) covers explicit writes, no-write and proposal
cases, project/user scope separation, idempotency, updates, forgetting, sensitive-data rejection, and
cross-session recall. Each trial captures independent before/after Memory file digests, the typed writer
result, and a fresh `memory check` result. A final response or a regular expression can never prove a
durable write.

Scenarios whose fixture or oracle cannot establish the promised behavior are marked
`evaluationStatus: inconclusive` in the catalog with a machine-readable repair reason. The Codex runner
writes an `evaluator-inconclusive` record without invoking the model; these trials stay out of metric
denominators and keep the gate `inconclusive` until the fixture is repaired. They must not be “fixed” by
retuning prompts or response matching.

Run the real unified Codex evaluation suite against one immutable candidate tarball:

```bash
pnpm run eval:codex -- \
  --package-artifact /absolute/path/harnessmith-x.y.z.tgz \
  --expected-package-sha256 <sha256> \
  --model <model> \
  --output-dir /absolute/new/codex-eval-suite
```

The suite writes family-scoped evidence directories and a schema v2 `suite-summary.json` below the requested
directory. A stage with non-passing scenario results fails the suite; it cannot be hidden by a
successful process exit. A missing fixture or independent oracle is `evaluator-inconclusive`; an executed
scenario that fails its observable contract is `behavior-failed`; a transport circuit stop can produce
`infra-blocked`. None of these outcomes is a release pass, and none is repaired by changing response
matching or rerunning the same unresolved evaluation. There is no standalone memory or matrix evaluation command; subprocess files are private adapters and cannot satisfy the release gate.

Before judging the stage scores, the suite records a coverage contract for all seven playbooks, all
seven reasoning modes and both activation types, the complete typed Memory operation surface, and
explicit profile/habit cases such as one-shot language, repeated observations, updates, ambiguous
forget requests, pause/resume, language precedence, and cross-session recall. Each cell is classified
as executable, evaluator-inconclusive, or missing. Current legacy Host evidence covers Memory state,
independent verifiers, command traces, and task/handoff state; the dedicated reasoning Host stage adds
route JSON capture, reasoning-section reads, and required artifacts. The suite still returns
`inconclusive` while any catalog cell lacks an executable fixture or independent oracle, rather than
allowing a deterministic route pass to masquerade as complete system coverage.

The report excludes inconclusive trials from precision/recall denominators and applies a release gate to
state violations, forbidden writes, and independent-verifier failures. Every failed trial is classified as
`policy-mismatch`, `state-mismatch`, `evidence-missing`, `verifier-failed`, `infra-inconclusive`,
`evaluator-inconclusive`, or `qualitative-only`. Only `policy-mismatch` is a model-behavior diagnosis; state,
verifier, evaluator-fixture, and infrastructure
failures route to their respective fixture/writer/transport repairs. The evaluator does not recommend
changing a prompt or regex and rerunning for those categories, so a failed run must first acquire a new
root-cause hypothesis and an independent verifier result.

Unit tests cover deterministic file and CLI behavior. This directory describes how maintainers record an observed run of the installed Harness in Codex, Cursor, Claude Code, OpenCode, Kimi Code CLI, or Zed Agent. Codex is required by the current release policy; records from the other five hosts are optional evidence. A schema fixture, scenario catalog, mock transcript, or passing unit test does not count as Host evidence.

## Before you start

This is a maintainer workflow, not an end-user installation guide. Prepare the following before running it:

- Node.js 24.12.0 or newer and the repository's pinned pnpm version; run `pnpm install --frozen-lockfile`.
- A clean, disposable workspace with an absolute path. Do not use a production checkout or a directory containing credentials.
- A built candidate tarball produced from the exact commit under review. Keep that file unchanged throughout installation, evaluation, and gating.
- For `eval:codex`, an authenticated local Codex CLI, an explicitly selected model, and permission to run the opt-in Host process. The workflow does not log in, approve access, or create credentials for you.
- A new evidence directory outside the candidate workspace, or an ignored `.agent-docs/host-evals/runs` directory. Never place raw credentials, cookies, private source, or unredacted transcripts in it.

If a Host transport, login, network, model, or disposable workspace is unavailable, record the result as `infra-inconclusive` or `inconclusive`; do not turn missing Host evidence into a passing record.

## Host capability evidence

Host capability metadata is an input to the unified `eval:codex` registry. It is not a second runner or a release gate. A capability without a Codex fixture remains `inconclusive`; adapter installation, a catalog entry, or a mock event cannot upgrade it. The suite records unsupported and unavailable Host capabilities explicitly beside the real Codex case evidence.

## Deterministic Prompt and route benchmark

The `eval:codex` suite runs the versioned bilingual corpus in `prompt-route-corpus.v1.json` as its deterministic
route stage. Its JSON report includes corpus/input digests, rule and candidate fingerprints, threshold metrics,
per-case false-positive/false-negative audit data, and provenance. A prior JSON report can be compared only when
both reports use the exact same corpus inputs.

This deterministic layer does not manufacture evaluator or Host telemetry. Fact verification, model tokens, and
Host tool calls stay `not-measured` until exact evidence exists, and a passing benchmark is not real Host proof.

## Evidence contract

`scenarios.schema.json` validates the versioned `scenarios.json` catalog, which contains the exact prompt,
setup, observable pass conditions, forbidden conditions, and local regression checks.
`run.schema.json` is the per-scenario behavior record contract used by the suite and historical diagnostics. The release gate does not accept
standalone `run.json` records, inherited cells, or an old validation result as a current release pass; it
requires the complete schema v2 `suite-summary.json` with the current candidate and evaluator-contract
digests. Each behavior run uses `recordType: host-evaluation` and records:

- host product/version and model/model version;
- package version, exact candidate tarball, embedded Harness, complete scenario contract
  (`id`/`prompt`/`setup`/`pass`/`forbidden`), its declared `dependencySha256`, distributed rule
  fingerprints, and the derived
  `behaviorSha256` used for bounded evidence inheritance;
- start and finish timestamps plus `evaluatedAt`, when the maintainer completed evidence review;
- the Host Eval tier, attempt count, elapsed time, termination reason, and enforced scenario/suite budgets;
- a redacted transcript artifact and SHA-256 digest;
- ordered tool actions, including approval and outcome;
- a filesystem-diff artifact, digest, and changed-path summary;
- one evidence-backed positive assertion for every ordered scenario `pass` condition (`pass-1`, `pass-2`, …);
- one evidence-backed assertion for every ordered scenario `forbidden` condition
  (`forbidden-1`, `forbidden-2`, …);
- a verdict whose references resolve to independently stored evidence artifacts.

Schema v6 is the per-scenario behavior record contract. It makes infrastructure and evaluator failures explicit
for individual `run.json` records, but it is not the release verdict. The unified schema v2 suite additionally
records `evaluator-inconclusive` for missing fixtures/oracles and `infra-blocked` for scenarios stopped by the
transport circuit or suite budget. No infrastructure or evaluator outcome satisfies current release coverage.

Each record is limited to a 15-minute scenario budget and a 60-minute suite budget. A run may retry once
(`maxAttempts: 2`); the record preserves the attempt count, transport-failure count, and whether execution
completed, exhausted its budget, failed in transport/evaluation, or stopped at an open circuit. This repository
validates those limits and classifications, plans incremental coverage, and provides an opt-in Codex process
transport plus a first-class unified suite driver. Nothing runs on import or during unit tests; real Host work
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
3. Prepare the authenticated Codex CLI and select the model. The suite installs the candidate into
   disposable fixtures and captures the actual Host, state, and verifier evidence.
4. Choose a new suite evidence directory outside the candidate workspace. Keep the generated summary
   and family records together; point `HARNESS_EVAL_RUNS_DIR` or `--runs-dir` at this suite root.
5. Run the unified suite explicitly; it writes the release evidence and schema v2 summary:

   ```bash
   pnpm run eval:codex -- \
     --package-artifact /absolute/path/to/release-candidate/harnessmith-x.y.z.tgz \
     --expected-package-sha256 <sha256> \
     --model gpt-5.6-sol \
     --output-dir /absolute/new/codex-eval-suite
   export HARNESS_EVAL_RUNS_DIR=/absolute/new/codex-eval-suite
   pnpm run eval:gate
   ```

`eval:validate` reads only behavior files named `run.json`; adjacent JSON may be an evidence artifact. It
checks schema, scenario identity, evidence references, containment, artifact digests, and high-confidence
secret patterns for diagnostics. `eval:plan` and `eval:compare` likewise help select or explain work but do
not create release coverage. `eval:gate` accepts only a complete, fresh schema v2 `suite-summary.json`
whose candidate SHA-256 and evaluator-contract digest match the current release; it rejects missing, stale,
behavior-failed, evaluator-inconclusive, evaluator-failed, infra-inconclusive, and infra-blocked suite
outcomes. The default freshness window is 30 days; use `--max-age-days` only when the release policy
explicitly chooses another bounded window.

On failure, human-readable output prints a `Rejected record summary` grouped by root cause and caps inline
audit details; use `eval:gate -- --json` for the complete machine-readable failure. JSON failures use the stable
`EVAL_COVERAGE_INCOMPLETE` code and include the missing suite cases, rejection counts, grouped reasons, and
all rejected record descriptions.

When a host/scenario cell contains multiple valid records, only the record with the latest `evaluatedAt` is
eligible for coverage. A tie at the latest timestamp is ambiguous and fails closed; an older passing record
therefore cannot mask a newer failed or inconclusive evaluation.

The rule fingerprint covers the files that are actually packaged: outer `bin/` and compiled `dist/`, embedded
Harness `bin/` and compiled `dist/`, schemas, `template/AGENTS.md`, routed Harness apps/docs/site, and generated
personal/project rule templates. The fingerprint output lists package-relative paths read from the candidate;
changing packaged executable behavior invalidates prior host records even if a maintainer forgets to bump a
version string.

Release state and attestation retain `exact`, `inherited`, and `infra-blocked` fields for schema
compatibility. The current suite gate puts passing cells in `exact`, sets
`inheritedBehaviorCoverageCount` to zero, and leaves inherited lists empty. `infra-blocked` never counts
toward passing coverage; a risk exception does not convert a blocked result into a passed suite.

## Historical fingerprints and planning

Artifact and behavior identities answer different questions:

- `packageArtifactSha256` identifies the exact npm tarball and changes on every metadata-only release;
- `behaviorSha256` is domain-separated from the artifact digest and covers the distributed executable and rule
  surface represented by `rulesSha256`;
- `scenarioSha256` independently identifies each Host scenario contract.
- `dependencySha256` identifies the declared behavior sources that can affect one scenario.

The fingerprint fields remain useful for diagnosing drift and for planning which scenarios need attention.
The current release gate does not consume inherited Host records: metadata-only similarity, an `eval:plan`
selection, or an older passing `run.json` cannot satisfy the current candidate's suite gate. A fresh schema v2
suite summary must bind every passing cell to the current candidate and evaluator-contract digest. A changed
scenario contract or declared dependency therefore requires the corresponding suite evidence; SemVer alone
never determines reuse.

`pnpm run eval:plan --changed-file PATH` classifies repository changes before real Host execution. L1 keeps
non-behavior changes in deterministic checks only. L2 selects at most three scenarios whose `dependencyPaths`
cover all changed behavior sources. L3 runs the full suite when a behavior source is unmapped
(`unmapped-behavior-source`) or the L2 selection would exceed that bound. This planner is fail closed: an
unknown behavior file never silently inherits Host evidence.

## Bounded runner and Codex transport contract

`scripts/evaluation/planning/eval-runner.ts` supplies the transport-neutral scheduling boundary used by real-Host adapters.
Independent scenarios run with 2 workers by default and at most 3-way bounded parallelism. Each
transport failure may retry once. Two consecutive transport failures open the circuit breaker, stop new work,
and classify scenarios that never started as `infra-blocked`; they are never converted into behavior failures.

The runner gives every attempt an `AbortSignal` and a hard deadline, enforces both the 15-minute scenario and
60-minute suite budgets, and preserves `behavior-failed`, `infra-inconclusive`, and `evaluator-failed` as
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

`pnpm run eval:codex` is the opt-in suite driver around that transport. It requires the complete unified
registry, an absolute candidate tarball and its pre-authorized SHA-256, an explicit Codex model, and a new
evidence directory. Defaults remain policy choices supplied by the caller; the release contract permits 1–3
workers, at most 15 minutes per scenario, at most 60 minutes for the suite, one transport retry, and at most
1 MiB each for Host stdout and stderr. For example:

```bash
pnpm run eval:codex -- \
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
of copying credentials into evidence. Each completed attempt writes family-specific records and sanitized
artifacts. The driver binds those records to a schema v2 `suite-summary.json`; run `eval:gate` separately
to verify release eligibility. Behavior, infrastructure, evaluator, circuit, and budget outcomes stay distinct.
An incomplete suite exits non-zero and never becomes release coverage.

The current suite gate binds every passing cell to the current candidate and evaluator-contract digests.
Legacy `run.json` records, inherited behavior cells, `eval:plan` selections, and `eval:compare` reports may
remain in the evidence directory for diagnosis, but none can satisfy current release coverage. Historical
records whose scenario fingerprint no longer matches are not eligible. `infra-blocked` and all other
non-passing suite outcomes remain visible and fail the current gate; they cannot be converted into exact
evidence by copying or reclassifying a legacy record.

The gate fails when schema v2 `suite-summary.json` is absent, stale, bound to another candidate or
evaluator contract, has `behavior-failed`, `evaluator-inconclusive`, `evaluator-failed`,
`infra-inconclusive`, or `infra-blocked` outcomes, or is missing any required scenario cell. The
current required host is Codex; Cursor, Claude Code, OpenCode, Kimi Code CLI, and Zed Agent can still be validated and retained as optional evidence.
The gate itself never launches, authenticates to, or spends money on a third-party host. Required Codex Host
execution is started only by an explicit unified-suite invocation such as `pnpm run eval:codex`; importing or
testing either module does not create evidence. Maintainers/CI still provide credentials and any non-Codex
Host setup.

A passing gate means only that the complete, fresh **maintainer-attested structure** is internally consistent
and bound to the selected candidate. Local JSON, hashes, and artifacts are forgeable by a repository writer;
the gate cannot prove that a real Host produced the submitted artifacts, that the transcript is complete, or
that the stated verdict is true. Trusted provenance requires an external CI/attestation system and review of
the underlying authorized Host runs.
