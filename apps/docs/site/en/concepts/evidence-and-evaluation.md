---
title: Evidence and evaluation
description: Distinguish repository verification, real host evaluation, record gates, and manual acceptance
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# Evidence and evaluation

An exit code of 0, the agent saying "done", and verified real-host behavior are three things that often get blended
into a single "pass". Harnessmith keeps them apart because each conclusion needs evidence at its own level. This
page explains what the four verification chains, the evaluation stages, and the post-release clean-room check can
each prove, and which conclusions must remain `inconclusive`.

This page covers the four verification chains, the five stages from task to conclusion, and the gates before and
after release. Together they bound how far the sentence "Harnessmith has verified a capability" can actually reach.

## Four complementary verification chains

Each chain answers a different question, and no chain may pass itself off as another's conclusion.

### Deterministic benchmarks for prompts and route

`pnpm run bench:prompt-route` runs the version 1 benchmark over the same set of inputs from
`evals/prompt-route-corpus.v1.json`. The report binds the corpus digest, an input digest containing only ids and
queries, the rules fingerprint, and the current router candidate digest; comparisons with `--baseline-report <path>`
require the corpus and input digests to be exactly identical, otherwise generating a delta is refused. Once the
corpus changes, the comparison loses its meaning.

Deterministic metrics include action routing Top-1 accuracy, topic recall, ambiguity precision/recall/rate,
forbidden action count, and the whole-case rule-adherence rate. Thresholds are stored in the versioned corpus; each
case keeps its expected/actual values, failure code, and `false-positive-guard` / `false-negative-guard`
classification. Keeping only aggregate scores would hide individual case failures, so it does not meet the evidence
requirement.

This chain carries an honest blind-spot declaration: the deterministic router does not read project facts and has no
model token or host tool-call telemetry, so fact verification, token cost, and tool-call cost must be reported as
`not-measured` and must never be estimated as 0; when no evidence exists at the mock/evaluator or real host layers,
they are likewise reported as `not-provided`. A benchmark `passed` only proves that the current source code meets its
deterministic contract for this corpus, with both `sourceOfTruth` and `hostProof` set to false; it cannot replace
the real Host Eval described below, nor prove that the agent actually follows the prompt, re-checks facts, or
controls token and tool costs.

### Deterministic repository verification

Unit tests, type checks, lint, schemas, `preflight`, coverage gates, and `npm pack --dry-run` run in a controlled
repository environment. They are well suited to proving repeatable properties such as path algorithms, state
machines, serialization contracts, package contents, and failure rollback — properties where the same input must
produce the same output, and running them a hundred times still holds.

This chain cannot prove that a third-party coding agent actually read the rules, triggered a permission prompt, or
used tools as the scenario expects. It governs consistency inside the repository; host behavior is outside its
jurisdiction.

### First Value local experience regression

`pnpm run eval:first-value` reproduces the setup preview, managed install, deterministic health, status explain, and
restore preview in a disposable local directory and emits a version 1 acceptance record. It catches regressions in
journey terminology, next-step guidance, and the install and restore entry points, and uploads no telemetry by
default.

The record explicitly separates `installed` and `healthy` from `host-configured` and `host-verified`. When the local
baseline passes, the host-owned states remain `inconclusive` and `firstValueAchieved` stays fixed at `false`; npm
downloads, GitHub traffic, and local tests are all listed as metrics that cannot be used to infer active users. For
the full journey, see the [First Value Loop](/en/guide/first-value-loop).

### Real host evaluation

A complete Host Eval uses the exact candidate tarball, executes scenarios in a real host, and collects sanitized
JSONL, tool behavior, file diffs, and verifier results. Scenario assertions check both expected and forbidden
behavior instead of judging success by keywords in the final text. The repository provides scenarios, record
schemas, and gate scripts, but does not start, log in to, or authenticate third-party hosts; real execution requires
maintainers to prepare the environment.

This chain costs more and is more exposed to authentication, network, host version, timeout, and
evaluation-infrastructure failures. That is why environment preparation, candidate binding, failure attribution, and
evidence retention are themselves part of the evaluation design, not just "run it and call it a day".

**Four fixed result categories.** Host Eval v6 records fix results into four categories: `passed` means behavior and
assertions passed; `behavior-failed` means real product behavior did not meet the scenario; termination by
transport, TLS, WebSocket, runner timeout, or circuit breaker can only be recorded as `infra-inconclusive`; when the
evaluator itself cannot reach a verdict, it is recorded as `evaluator-failed`. The last three categories cannot
satisfy release coverage, and in particular `infra-inconclusive` must never be downgraded into a product-behavior
failure or pass — broken infrastructure says nothing about whether the product is right or wrong.

**Budgets and retries.** Execution evidence records tier, attempt, elapsed time, and termination together. The
per-scenario budget is capped at 15 minutes and the whole-matrix budget at 60 minutes; a transport failure is
automatically retried at most once, so the total number of attempts never exceeds two. `eval:validate` rejects
records that exceed budgets, exceed the retry limit, or whose termination conflicts with the result category. The
current implementation also provides dependency-scoped incremental selection, a host-neutral runner, and an explicit
process transport for the currently required host, Codex; CI authentication and transports for other third-party
hosts remain to be delivered by later integrations.

**Incremental selection and dependency binding.** Each scenario declares `dependencyPaths` that can affect its
behavior, and the fingerprint binds those files as a separate `dependencySha256`; the global `rulesSha256` continues
to serve auditing, but an unrelated rule change no longer invalidates every scenario record. `eval:plan` classifies
changes into L1, L2, and L3: L1 needs only deterministic verification; L2 selects at most three host scenarios
covered by the dependency mapping; L3 runs the full matrix for unknown behavior sources or overly broad selections.
When `unmapped-behavior-source` appears, it must fail closed to L3 and never silently inherit old evidence.

**Scheduling and transport details.** The scheduling layer provides a host-neutral runner contract: independent
scenarios run with bounded parallelism of 2 by default and at most 3; a single transport failure is retried at most
once, and after two consecutive failures the circuit-breaker opens and scenarios that have not yet started are
explicitly recorded as `infra-blocked`. The runner passes an `AbortSignal` with a hard deadline to every execution
and enforces both the per-scenario and whole-matrix budgets. `behavior-failed` and `evaluator-failed` never trigger
the transport circuit breaker and are never confused with `infra-inconclusive`. The Codex transport uses shell-free
argv, a stdin prompt, an ephemeral JSONL session, the `workspace-write` sandbox, and automatic approval review; it
accepts only absolute disposable workspaces and limits stdout and stderr to 1 MiB each. Runner cancellation
terminates the process tree; startup, connection, TLS, and WebSocket failures are classified as transport failures,
while output-limit violations, unknown non-zero exits, or evaluator crashes are classified as evaluator failures. An
exit code of 0 must still be handed to an independent evaluator and can never be automatically upgraded to a
behavior pass. This capability does not automatically log in to, start, or persist third-party host evidence; a real
RC rehearsal still requires maintainers to execute and review it explicitly.

#### Candidate—baseline host A/B comparison

`pnpm run eval:compare -- --baseline-runs-dir <dir> --baseline-artifact <tgz> --candidate-runs-dir <dir> --candidate-artifact <tgz>`
first reuses the existing schema, artifact, and secret checks, then pairs runs one-to-one by Adapter, host product
and version, model and model version, scenario ID, and scenario fingerprint. The tarball SHA-256 on each side must
match its records respectively; dependency, rules, and artifact fingerprints are kept separately as the
implementation under test, are allowed to differ, and must not be mistaken for environment drift.

Each unit is classified as `improved`, `unchanged-passed`, `regressed`, `unchanged-failed`, or `inconclusive`. When
either side has an undecidable transport/evaluator outcome, the unit can only be `inconclusive`; an overall pass
requires every candidate unit to pass with no regressions. The report provides deltas for assertions, forbidden
behavior, tool action counts, and elapsed time; current records have no stable token field, so tokens are explicitly
written as `not-measured`. This comparison reduces manual side-by-side errors, but it does not start hosts, generate
evidence, or replace the release gate or manual semantic review.

**Grading release evidence.** Release evidence distinguishes `exact`, `inherited`, and `infra-blocked` per matrix
unit: `exact` binds the current candidate artifact; `inherited` additionally binds the source version and artifact
digest; `infra-blocked` never counts toward passing coverage. The release state and release attestation keep all
three lists and check them for consistency with the aggregate counts, `inheritedFrom`, and the full release matrix.
A normal release must contain no `infra-blocked` units; a risk exception may only record blocked units already
included in the exact `uncoveredScenarios`, and infrastructure blockage can never be converted into passing
evidence. Old schemas remain readable, while newly prepared releases write the explicit evidence schema.

## The five stages from task to conclusion

1. **Define the task and acceptance**: scenarios state what to observe and which behavior is explicitly forbidden.
2. **Check readiness**: confirm the candidate package, host, authentication, and dependencies are available, so
   environment failures are not misjudged as product failures.
3. **Controlled execution and collection**: run the real host and keep bounded, sanitized, traceable traces and file
   evidence.
4. **Multi-layer judgment and attribution**: combine mechanical verifiers, scenario assertions, and manual review to
   separate model, Harness, environment, and evaluator problems.
5. **Regression and release feedback**: bind results to the exact candidate and the release policy; re-run the
   evaluation after implementation or rule changes.

## What `eval:validate` and `eval:gate` can prove

They check the record schema, candidate package version and SHA-256, behavior fingerprint, freshness, scenario
coverage, artifact digests, and the internal consistency of assertions and verdicts. The release gate also checks
that all hosts and scenarios required by the current policy are present.

It is equally important to state what they cannot prove: that a record definitely came from a real host, that the
pre-sanitization evidence was complete, that the maintainer's conclusion is correct, or that a third-party service
had no anomalies. Whoever writes to the repository can forge a structurally correct local record; stronger trust
requires external CI, signed attestation, and manual evidence review. Gates stop honest mistakes, not deliberate
forgery.

## The post-release registry clean-room

The pre-release tarball and Host Eval cannot prove that the npm registry ultimately serves users the same bytes.
Between publishing and global propagation there is a window the publisher does not control. The tag publish workflow
therefore runs `release:verify-registry` after `npm publish` succeeds: it waits for the exact version to become
visible, checks the official registry metadata, SHA-1, SHA-512 integrity, SHA-256, and provenance, then performs an
isolated install of the actually downloaded tarball, with both HOME and the npm cache inside a managed temporary
directory. The smoke checks cover, in order, the outer CLI version, capabilities, a no-write dry run, a minimal
install, and the embedded Harness's doctor and health.

The verification output classifies propagation delay, metadata mismatches, integrity mismatches, and run failures
into stable error codes and writes them to `registry-verification.json` for the corresponding GitHub Actions run to
upload. When publishing already succeeded but the clean-room fails, it only preserves diagnostic evidence and stops
creating the GitHub Release; it never attempts to overwrite or delete the immutable published version on npm. The
bytes in the registry cannot be changed — the only option left is to withhold the stamp.

## Why not check only the final text

The final text may say "tests passed" while no files were modified; it may also lack the expected keywords even
though the correct tool calls were completed. Harnessmith scenarios can combine structured tool records, file system
diffs, independent verifiers, per-item behavior assertions, and forbidden-behavior assertions. Text matching can be
one local predicate, but it should not decide the overall verdict on its own.

## How to interpret evaluation failures

First, separate product-behavior failures from evaluation-infrastructure failures. Being unable to reach the host,
expired authentication, or a runner timeout can only yield `infra-inconclusive` and cannot directly prove that
Harnessmith does not support that host; a failure of the evaluator itself must be recorded as `evaluator-failed` and
cannot masquerade as `behavior-failed`. Likewise, a local `eval:validate` pass cannot be upgraded into "verified on
a real host".

For the concrete commands, see `eval:check`, `eval:validate`, `eval:gate`, `release:check`, and
`release:verify-registry` in the project's `package.json`; the currently published capabilities and evidence paths
are defined by the
[capability claims—evidence matrix](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml).
