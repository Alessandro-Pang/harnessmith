import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { CodexSuiteSummary } from '../codex/eval-codex-suite.js';
import {
  bindCaseEvidence,
  collectSuiteArtifacts,
  readSuiteArtifact,
} from '../codex/eval-suite-evidence.js';
import { evaluationContractDigest, evaluationRegistry } from '../codex/eval-suite-registry.js';
import { summarizeSuiteResults } from '../codex/eval-suite-scheduler.js';
import { evaluateCoverage } from './eval-coverage.js';

export function verifySuiteEvidence(options: {
  directory: string;
  candidateSha256: string;
  maxAgeDays: number;
}): CodexSuiteSummary {
  if (!existsSync(join(options.directory, 'suite-summary.json')))
    throw new Error(
      'A complete unified evaluation suite record is required; standalone behavior records cannot satisfy the release gate',
    );
  const summary = JSON.parse(
    readSuiteArtifact(options.directory, 'suite-summary.json').toString('utf8'),
  ) as CodexSuiteSummary;
  if (summary.schemaVersion !== 2 || summary.recordType !== 'codex-evaluation-suite')
    throw new Error('A complete unified evaluation suite record is required');
  if (
    summary.candidateSha256 !== options.candidateSha256 ||
    summary.contractSha256 !== evaluationContractDigest()
  )
    throw new Error('Suite candidate or evaluator contract has changed');
  const start = Date.parse(summary.startedAt),
    finish = Date.parse(summary.finishedAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(finish) ||
    start > finish ||
    finish > Date.now() ||
    finish < Date.now() - options.maxAgeDays * 86400000
  )
    throw new Error('Suite timestamps are invalid or stale');
  if (
    summary.host?.adapter !== 'codex' ||
    !summary.host.version ||
    !summary.host.model ||
    summary.host.reasoningEffort !== 'medium'
  )
    throw new Error('Suite Host/model/effort identity is incomplete');
  const entries = evaluationRegistry();
  const requiredIds = entries.map((entry) => entry.id);
  if (
    !Array.isArray(summary.results) ||
    summarizeSuiteResults(requiredIds, summary.results) !== 'passed'
  )
    throw new Error('Unified suite contains missing or non-passing cases');
  if (
    summary.result !== 'passed' ||
    summary.circuitOpen ||
    summary.promptRoute?.result !== 'passed'
  )
    throw new Error('Unified suite is not passing');
  const artifacts = collectSuiteArtifacts(options.directory);
  if (!isDeepStrictEqual(artifacts, summary.artifacts))
    throw new Error('Suite artifacts are missing, changed, or unregistered');
  const rebound = summary.results.map((result) => {
    const entry = entries.find((entry) => entry.id === result.scenarioId);
    if (!entry) throw new Error('Unknown suite case');
    return bindCaseEvidence(
      options.directory,
      entry,
      result,
      options.candidateSha256,
      summary.host.model,
    );
  });
  if (
    !isDeepStrictEqual(rebound, summary.results) ||
    summarizeSuiteResults(requiredIds, rebound) !== 'passed'
  )
    throw new Error('Suite record references or assertions are invalid');
  const coverage = evaluateCoverage(rebound, entries);
  if (coverage.result !== 'passed' || !isDeepStrictEqual(coverage, summary.coverage))
    throw new Error('Suite coverage is incomplete or disagrees with actual records');
  return summary;
}
