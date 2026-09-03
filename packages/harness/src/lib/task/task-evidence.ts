import type { ProjectSnapshot, TaskBaselineDrift, TaskEvidence, TaskRecord } from '../../types.js';
import { sameExistingPath } from '../filesystem/safe-path.js';
import { assertNoHighConfidenceSecret } from '../security/secret-hygiene.js';
import { fileDigestIsFresh, scopeDigestsAreFresh } from './task-verification-scope.js';

function evidenceObject(input: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {}
  throw new Error('Evidence must be a JSON object with a supported type');
}

function assertKeys(value: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`Unsupported evidence fields: ${extra.join(', ')}`);
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`Evidence ${field} must be a non-empty string`);
  }
  return result.trim();
}

export function captureTaskEvidence(
  inputs: string[],
  snapshot: ProjectSnapshot,
  recordedAt: string,
  taskId: string,
  criterionId: string | null,
): TaskEvidence[] {
  assertNoHighConfidenceSecret(inputs, 'Task evidence');
  return inputs.map((input) => {
    const value = evidenceObject(input);
    assertNoHighConfidenceSecret([JSON.stringify(value)], 'Task evidence');
    const type = value.type;
    const common = {
      producer: 'external' as const,
      verificationPassed: false,
      taskId,
      criterionId,
      recordedAt,
      cwd: snapshot.root,
      head: snapshot.head,
      workspaceDigest: snapshot.workspaceDigest,
      scopeDigests: [],
    };
    if (type === 'command' || type === 'test') {
      assertKeys(value, ['type', 'command', 'exitCode']);
      if (!Number.isInteger(value.exitCode) || (value.exitCode as number) < 0) {
        throw new Error('Evidence exitCode must be a non-negative integer');
      }
      return {
        type,
        ...common,
        command: requiredString(value, 'command'),
        args: [],
        exitCode: value.exitCode as number,
        signal: null,
        timedOut: false,
        outputDigest: null,
      };
    }
    if (type === 'file' || type === 'diff') {
      assertKeys(value, ['type', 'reference', 'artifactDigest']);
      const artifactDigest = requiredString(value, 'artifactDigest');
      if (!/^sha256:[0-9a-f]{64}$/.test(artifactDigest)) {
        throw new Error('Evidence artifactDigest must use sha256:<64 lowercase hex>');
      }
      return { type, ...common, reference: requiredString(value, 'reference'), artifactDigest };
    }
    if (type === 'browser' || type === 'observation') {
      assertKeys(value, ['type', 'tool', 'result', 'host']);
      return {
        type,
        ...common,
        tool: requiredString(value, 'tool'),
        result: requiredString(value, 'result'),
        ...(value.host !== undefined ? { host: requiredString(value, 'host') } : {}),
      };
    }
    if (type === 'legacy') throw new Error('Legacy evidence can only be migrated from an old task');
    throw new Error(`Unsupported evidence type: ${String(type)}`);
  });
}

export function taskBaselineDrift(task: TaskRecord, snapshot: ProjectSnapshot): TaskBaselineDrift {
  return {
    branch: task.baseline.branch !== snapshot.branch,
    head: task.baseline.head !== snapshot.head,
    dirty: task.baseline.dirty !== snapshot.dirty,
    currentBranch: snapshot.branch,
    currentHead: snapshot.head,
    currentDirty: snapshot.dirty,
  };
}

export function evidenceSupportsPass(
  evidence: TaskEvidence,
  task: TaskRecord,
  snapshot: ProjectSnapshot,
  criterionId: string,
): boolean {
  const recordedAt = Date.parse(evidence.recordedAt);
  if (
    evidence.producer !== 'harness' ||
    !evidence.verificationPassed ||
    evidence.taskId !== task.id ||
    evidence.criterionId !== criterionId ||
    !Number.isFinite(recordedAt) ||
    recordedAt < Date.parse(task.created) ||
    recordedAt > Date.now() + 5 * 60_000 ||
    !sameExistingPath(evidence.cwd, task.projectRoot) ||
    evidence.head !== snapshot.head ||
    evidence.workspaceDigest === null ||
    evidence.workspaceDigest !== snapshot.workspaceDigest ||
    !scopeDigestsAreFresh(task.projectRoot, evidence.scopeDigests)
  ) {
    return false;
  }
  if (evidence.type === 'command' || evidence.type === 'test') {
    return (
      evidence.exitCode === 0 &&
      evidence.signal === null &&
      !evidence.timedOut &&
      Boolean(evidence.outputDigest?.match(/^sha256:[0-9a-f]{64}$/))
    );
  }
  if (evidence.type === 'file') {
    return fileDigestIsFresh(task.projectRoot, evidence.reference, evidence.artifactDigest);
  }
  if (evidence.type === 'diff') return evidence.artifactDigest === snapshot.workspaceDigest;
  return false;
}

export function assertTaskCanComplete(task: TaskRecord, snapshot: ProjectSnapshot): void {
  const incomplete = task.acceptance.filter((criterion) => criterion.status !== 'passed');
  if (incomplete.length > 0) {
    throw new Error(
      `Cannot complete task; acceptance is not passed: ${incomplete.map(({ id }) => id).join(', ')}`,
    );
  }
  const unsupported = task.acceptance.filter(
    (criterion) =>
      !criterion.evidence.some((evidence) =>
        evidenceSupportsPass(evidence, task, snapshot, criterion.id),
      ),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Cannot complete task; stale or non-passing evidence: ${unsupported.map(({ id }) => id).join(', ')}`,
    );
  }
}
