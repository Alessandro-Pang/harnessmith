import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readMemoryEvaluationRecords } from '../memory/memory-report.js';
import type { HostEvalScenarioResult } from '../planning/eval-runner.js';
import { validateEvaluationRecords } from '../records/eval-records.js';
import { attemptDirectory } from './eval-suite-process.js';
import type { EvaluationCase } from './eval-suite-registry.js';

export type SuiteArtifact = { path: string; sha256: string; bytes: number };
export type SuiteCaseResult = HostEvalScenarioResult & {
  recordRef?: string;
  recordSha256?: string;
  evidenceKinds?: string[];
  evidenceError?: string;
};
export const digest = (content: string | Buffer) =>
  createHash('sha256').update(content).digest('hex');

export function readSuiteArtifact(root: string, path: string): Buffer {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (isAbsolute(path) || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`Evidence escapes suite: ${path}`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new Error(`Evidence must be a bounded regular file: ${path}`);
  if (relative(realpathSync(root), realpathSync(target)).startsWith('..'))
    throw new Error(`Evidence symlink escapes suite: ${path}`);
  return readFileSync(target);
}

export function collectSuiteArtifacts(root: string): SuiteArtifact[] {
  const artifacts: SuiteArtifact[] = [];
  let total = 0;
  const visit = (directory: string, depth: number) => {
    if (depth > 8) throw new Error('Suite evidence exceeds depth limit');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'suite-summary.json') continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) visit(target, depth + 1);
      else {
        const path = relative(root, target);
        const content = readSuiteArtifact(root, path);
        total += content.length;
        if (artifacts.length >= 10000 || total > 256 * 1024 * 1024)
          throw new Error('Suite evidence exceeds aggregate limit');
        artifacts.push({ path, sha256: digest(content), bytes: content.length });
      }
    }
  };
  visit(root, 0);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function recordPaths(root: string): string[] {
  return collectSuiteArtifacts(root)
    .filter((artifact) =>
      ['run.json', 'result.json'].includes(artifact.path.split('/').at(-1) ?? ''),
    )
    .map((artifact) => artifact.path);
}

function evidenceKindsFor(entry: EvaluationCase, record: Record<string, unknown>): string[] {
  const kinds = new Set<string>();
  if (entry.family === 'reasoning') {
    const result = record.result as Record<string, unknown> | undefined;
    const evidence = (result?.evidence ?? record.evidence) as Record<string, unknown> | undefined;
    if (evidence?.routeJson === true) kinds.add('route-json');
    if (evidence?.reasoningSectionRead === true) kinds.add('reasoning-section-read');
    if (Array.isArray(evidence?.requiredArtifacts) && evidence.requiredArtifacts.length > 0)
      kinds.add('required-artifacts');
  }
  if (entry.family === 'memory') {
    const stateEvidence = record.stateEvidence as Record<string, unknown> | undefined;
    if (stateEvidence?.beforeDigest && stateEvidence?.afterDigest)
      kinds.add('memory-state-before-after');
    const verifier = record.verifier as Record<string, unknown> | undefined;
    if (verifier?.passed === true) kinds.add('independent-verifier');
    if (/(handoff|lifecycle|acceptance)/u.test(entry.sourceId)) kinds.add('task-or-handoff-state');
  }
  if (entry.family === 'behavior') {
    if (Array.isArray(record.toolActions) && record.toolActions.length > 0)
      kinds.add('tool-or-command-trace');
    if (
      Array.isArray(record.evidence) &&
      record.evidence.some((item: { kind?: string }) =>
        ['test', 'file', 'log', 'observation'].includes(item.kind ?? ''),
      )
    )
      kinds.add('independent-verifier');
    if (/(task|handoff|acceptance|lifecycle)/u.test(entry.sourceId))
      kinds.add('task-or-handoff-state');
  }
  return [...kinds].sort();
}

export function bindCaseEvidence(
  root: string,
  entry: EvaluationCase,
  result: HostEvalScenarioResult,
  candidateSha256: string,
  model: string,
): SuiteCaseResult {
  if (result.attempts === 0) return result;
  const directory = attemptDirectory(root, entry, result.attempts);
  try {
    if (!existsSync(directory)) throw new Error('case evidence directory is missing');
    const records = recordPaths(directory);
    if (records.length !== 1) throw new Error('case requires exactly one final run record');
    const recordRef = relative(root, join(directory, records[0]));
    const bytes = readSuiteArtifact(root, recordRef);
    const record = JSON.parse(bytes.toString('utf8'));
    const outcome = entry.family === 'behavior' ? record.verdict?.outcome : record.outcome;
    const id = record.scenarioId ?? record.id;
    if (id !== entry.sourceId || outcome !== result.outcome)
      throw new Error('child summary and evidence record disagree');
    if (entry.family === 'behavior') validateEvaluationRecords({ runsDirectory: directory });
    if (entry.family === 'memory') {
      readMemoryEvaluationRecords(directory);
      if (record.promptVariant !== entry.promptVariant)
        throw new Error('memory prompt variant mismatch');
    }
    const candidate = record.subject?.packageArtifactSha256 ?? record.candidateSha256;
    if (candidate !== candidateSha256 || record.host?.model !== model)
      throw new Error('case record candidate or model mismatch');
    const evidenceKinds = evidenceKindsFor(entry, record);
    return { ...result, recordRef, recordSha256: digest(bytes), evidenceKinds };
  } catch (error) {
    const evidenceError = error instanceof Error ? error.message : String(error);
    // Missing evidence after transport/time exhaustion remains an infrastructure result.
    return result.outcome.startsWith('infra-')
      ? { ...result, evidenceError }
      : { ...result, outcome: 'evaluator-failed', termination: 'evaluator-failure', evidenceError };
  }
}
