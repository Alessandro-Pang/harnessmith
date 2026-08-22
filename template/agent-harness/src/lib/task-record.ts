import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import taskSchema from '../../schemas/task.schema.json' with { type: 'json' };
import type { AcceptanceStatus, TaskEvidence, TaskRecord } from '../types.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const taskAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(taskAjv);
const validateTaskSchema = taskAjv.compile(taskSchema);

interface LegacyCriterion<T> {
  id: string;
  description: string;
  status: AcceptanceStatus;
  evidence: T[];
}

interface LegacyCheckpoint<T> {
  time: string;
  summary: string;
  evidence: T[];
  nextAction?: string;
}

interface LegacyTaskRecord<T, V extends 1 | 2>
  extends Omit<TaskRecord, 'schemaVersion' | 'acceptance' | 'checkpoints'> {
  schemaVersion: V;
  acceptance: Array<LegacyCriterion<T>>;
  checkpoints: Array<LegacyCheckpoint<T>>;
}

interface V2Evidence {
  type: 'command' | 'test' | 'file' | 'diff' | 'browser' | 'observation' | 'legacy';
  recordedAt: string;
  cwd: string;
  head: string | null;
  workspaceDigest: string | null;
  command?: string;
  exitCode?: number;
  reference?: string;
  artifactDigest?: string;
  tool?: string;
  result?: string;
  host?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function legacyEvidence(
  reference: string,
  recordedAt: string,
  task: { projectRoot: string; baseline: { head: string | null } },
  taskId: string,
  criterionId: string | null,
): TaskEvidence {
  return {
    type: 'legacy',
    producer: 'legacy',
    verificationPassed: false,
    taskId,
    criterionId,
    reference,
    recordedAt,
    cwd: task.projectRoot,
    head: task.baseline.head,
    workspaceDigest: null,
    scopeDigests: [],
  };
}

function migrateV2Evidence(
  value: V2Evidence,
  taskId: string,
  criterionId: string | null,
): TaskEvidence {
  const common = {
    producer: value.type === 'legacy' ? ('legacy' as const) : ('external' as const),
    verificationPassed: false,
    taskId,
    criterionId,
    recordedAt: value.recordedAt,
    cwd: value.cwd,
    head: value.head,
    workspaceDigest: value.workspaceDigest,
    scopeDigests: [],
  };
  if (value.type === 'command' || value.type === 'test') {
    return {
      type: value.type,
      ...common,
      command: value.command || 'unverified-v2-command',
      args: [],
      exitCode: Number.isInteger(value.exitCode) ? (value.exitCode as number) : null,
      signal: null,
      timedOut: false,
      outputDigest: null,
    };
  }
  if (value.type === 'file' || value.type === 'diff') {
    return {
      type: value.type,
      ...common,
      reference: value.reference || 'unverified-v2-artifact',
      artifactDigest: value.artifactDigest || `sha256:${'0'.repeat(64)}`,
    };
  }
  if (value.type === 'browser' || value.type === 'observation') {
    return {
      type: value.type,
      producer: 'external',
      verificationPassed: false,
      taskId,
      criterionId,
      recordedAt: value.recordedAt,
      cwd: value.cwd,
      head: value.head,
      workspaceDigest: value.workspaceDigest,
      scopeDigests: [],
      tool: value.tool || 'unverified-v2-tool',
      result: value.result || 'unverified-v2-result',
      ...(value.host ? { host: value.host } : {}),
    };
  }
  return {
    type: 'legacy',
    producer: 'legacy',
    verificationPassed: false,
    taskId,
    criterionId,
    recordedAt: value.recordedAt,
    cwd: value.cwd,
    head: value.head,
    workspaceDigest: value.workspaceDigest,
    scopeDigests: [],
    reference: value.reference || 'unverified-v2-legacy',
  };
}

function recoverTransitionalV3(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== 3) return value;
  if (
    typeof value.id !== 'string' ||
    typeof value.projectRoot !== 'string' ||
    typeof value.updated !== 'string' ||
    !isRecord(value.baseline) ||
    (typeof value.baseline.head !== 'string' && value.baseline.head !== null) ||
    !Array.isArray(value.acceptance) ||
    !Array.isArray(value.checkpoints)
  ) {
    return value;
  }
  const task = {
    projectRoot: value.projectRoot,
    baseline: { head: value.baseline.head },
  };
  let recovered = false;
  const convert = (item: unknown, time: string, criterionId: string | null): unknown => {
    if (typeof item !== 'string') return item;
    recovered = true;
    return legacyEvidence(item, time, task, value.id as string, criterionId);
  };
  const closed = value.status === 'complete' || value.status === 'superseded';
  const acceptance = value.acceptance.map((criterion) => {
    if (!isRecord(criterion) || !Array.isArray(criterion.evidence)) return criterion;
    const criterionId = typeof criterion.id === 'string' ? criterion.id : null;
    const evidence = criterion.evidence.map((item) =>
      convert(item, value.updated as string, criterionId),
    );
    return {
      ...criterion,
      ...(!closed &&
      criterion.status === 'passed' &&
      evidence.some((item) => isRecord(item) && item.type === 'legacy')
        ? { status: 'inconclusive' }
        : {}),
      evidence,
    };
  });
  const checkpoints = value.checkpoints.map((checkpoint) => {
    if (!isRecord(checkpoint) || !Array.isArray(checkpoint.evidence)) return checkpoint;
    const time = typeof checkpoint.time === 'string' ? checkpoint.time : (value.updated as string);
    return {
      ...checkpoint,
      evidence: checkpoint.evidence.map((item) => convert(item, time, null)),
    };
  });
  return recovered ? { ...value, acceptance, checkpoints } : value;
}

export function normalizeTaskRecord(value: unknown, path: string): TaskRecord {
  const recovered = recoverTransitionalV3(value);
  if (!validateTaskSchema(recovered)) {
    throw new Error(
      `Invalid task schema ${path}: ${taskAjv.errorsText(validateTaskSchema.errors, { separator: '; ' })}`,
    );
  }
  const recoveredTask = recovered as { acceptance: Array<{ id: string }> };
  const criterionIds = new Set<string>();
  for (const criterion of recoveredTask.acceptance) {
    if (criterionIds.has(criterion.id)) {
      throw new Error(
        `Invalid task schema ${path}: duplicate acceptance criterion id: ${criterion.id}`,
      );
    }
    criterionIds.add(criterion.id);
  }
  const raw = recovered as
    | TaskRecord
    | LegacyTaskRecord<string, 1>
    | LegacyTaskRecord<V2Evidence, 2>;
  if (raw.schemaVersion === 3) return raw;
  const closed = raw.status === 'complete' || raw.status === 'superseded';
  const evidence = (
    item: string | V2Evidence,
    time: string,
    criterionId: string | null,
  ): TaskEvidence =>
    raw.schemaVersion === 1
      ? legacyEvidence(item as string, time, raw, raw.id, criterionId)
      : migrateV2Evidence(item as V2Evidence, raw.id, criterionId);
  const migrated: TaskRecord = {
    ...raw,
    schemaVersion: 3,
    acceptance: raw.acceptance.map((criterion) => ({
      ...criterion,
      status: !closed && criterion.status === 'passed' ? 'inconclusive' : criterion.status,
      evidence: criterion.evidence.map((item) => evidence(item, raw.updated, criterion.id)),
    })),
    checkpoints: raw.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      evidence: checkpoint.evidence.map((item) => evidence(item, checkpoint.time, null)),
    })),
  };
  if (!validateTaskSchema(migrated)) {
    throw new Error(
      `Invalid migrated task schema ${path}: ${taskAjv.errorsText(validateTaskSchema.errors, { separator: '; ' })}`,
    );
  }
  return migrated;
}
