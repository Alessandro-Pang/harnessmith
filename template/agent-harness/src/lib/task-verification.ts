import { createHash } from 'node:crypto';
import { execaSync } from 'execa';
import type { ProjectSnapshot, TaskEvidence } from '../types.js';
import { projectSnapshot } from './project.js';
import { containsHighConfidenceSecret } from './secret-hygiene.js';
import { captureScopeDigests, fileDigest } from './task-verification-scope.js';

const maximumOutputBytes = 4 * 1024 * 1024;
const maximumTimeoutMs = 10 * 60_000;

export interface MechanicalEvidenceInput {
  type: 'command' | 'test' | 'file' | 'diff';
  command?: string;
  args?: string[];
  scope?: string[];
  file?: string;
  timeoutMs?: number;
}

export interface MechanicalEvidenceResult {
  evidence: TaskEvidence;
  snapshot: ProjectSnapshot;
  passed: boolean;
  failure: string | null;
}

function sha256(...values: Array<Uint8Array | string>): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(value);
  return `sha256:${hash.digest('hex')}`;
}

function commandFailure(
  scopeFailure: string | null,
  workspaceDigest: string | null,
  timedOut: boolean,
  timeoutMs: number,
  signal: string | null,
  exitCode: number | null,
): string | null {
  if (scopeFailure) return scopeFailure;
  if (workspaceDigest === null) return 'project workspace digest is unavailable';
  if (timedOut) return `timed out after ${timeoutMs} ms`;
  if (signal) return `terminated by signal ${signal}`;
  if (exitCode === null) return 'could not execute';
  return exitCode === 0 ? null : `exit code ${exitCode}`;
}

function commandEvidence(
  root: string,
  input: MechanicalEvidenceInput,
  recordedAt: string,
  taskId: string,
  criterionId: string,
): MechanicalEvidenceResult {
  const command = input.command?.trim();
  if (!command) throw new Error('Command verification requires --command <executable>');
  const args = input.args || [];
  if ([command, ...args].some(containsHighConfidenceSecret)) {
    throw new Error('Command verification contains high-confidence secret material');
  }
  const timeoutMs = input.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maximumTimeoutMs) {
    throw new Error(`Verification timeout must be between 1 and ${maximumTimeoutMs} ms`);
  }
  const beforeScopeDigests = captureScopeDigests(root, input.scope || []);
  const beforeSnapshot = projectSnapshot(root);
  const execution = execaSync(command, args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: maximumOutputBytes,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
    timeout: timeoutMs,
  });
  const stdout = Buffer.from(execution.stdout || []);
  const stderr = Buffer.from(execution.stderr || []);
  const exitCode = execution.exitCode ?? null;
  const signal = execution.signal || null;
  const timedOut = execution.timedOut;
  const snapshot = projectSnapshot(root);
  let scopeDigests = beforeScopeDigests;
  let scopeFailure: string | null = null;
  try {
    scopeDigests = captureScopeDigests(root, input.scope || []);
    if (JSON.stringify(scopeDigests) !== JSON.stringify(beforeScopeDigests)) {
      scopeFailure = 'verification scope changed while the command was running';
    }
  } catch (error) {
    scopeFailure = error instanceof Error ? error.message : String(error);
  }
  if (
    beforeSnapshot.head !== snapshot.head ||
    beforeSnapshot.workspaceDigest !== snapshot.workspaceDigest
  ) {
    scopeFailure = scopeFailure || 'project workspace changed while the command was running';
  }
  const passed =
    exitCode === 0 &&
    signal === null &&
    !timedOut &&
    scopeFailure === null &&
    snapshot.workspaceDigest !== null;
  const failure = commandFailure(
    scopeFailure,
    snapshot.workspaceDigest,
    timedOut,
    timeoutMs,
    signal,
    exitCode,
  );
  return {
    snapshot,
    passed,
    failure,
    evidence: {
      type: input.type as 'command' | 'test',
      producer: 'harness',
      verificationPassed: passed,
      taskId,
      criterionId,
      recordedAt,
      cwd: snapshot.root,
      head: snapshot.head,
      workspaceDigest: snapshot.workspaceDigest,
      scopeDigests,
      command,
      args,
      exitCode,
      signal,
      timedOut,
      outputDigest: sha256(stdout, '\0stderr\0', stderr),
    },
  };
}

export function mechanicallyVerifyEvidence(
  root: string,
  input: MechanicalEvidenceInput,
  recordedAt: string,
  taskId: string,
  criterionId: string,
): MechanicalEvidenceResult {
  if (input.type === 'command' || input.type === 'test') {
    return commandEvidence(root, input, recordedAt, taskId, criterionId);
  }
  const snapshot = projectSnapshot(root);
  if (input.type === 'file') {
    if (!input.file) throw new Error('File verification requires --file <path>');
    const artifact = fileDigest(root, input.file);
    const passed = snapshot.workspaceDigest !== null;
    return {
      snapshot,
      passed,
      failure: passed ? null : 'project workspace digest is unavailable',
      evidence: {
        type: 'file',
        producer: 'harness',
        verificationPassed: passed,
        taskId,
        criterionId,
        recordedAt,
        cwd: snapshot.root,
        head: snapshot.head,
        workspaceDigest: snapshot.workspaceDigest,
        scopeDigests: [artifact],
        reference: artifact.path,
        artifactDigest: artifact.digest,
      },
    };
  }
  if (input.type === 'diff') {
    if (!snapshot.isGitRepository || !snapshot.workspaceDigest) {
      throw new Error('Diff verification requires a readable Git workspace');
    }
    const scopeDigests = captureScopeDigests(root, input.scope || []);
    return {
      snapshot,
      passed: true,
      failure: null,
      evidence: {
        type: 'diff',
        producer: 'harness',
        verificationPassed: true,
        taskId,
        criterionId,
        recordedAt,
        cwd: snapshot.root,
        head: snapshot.head,
        workspaceDigest: snapshot.workspaceDigest,
        scopeDigests,
        reference: 'git-workspace',
        artifactDigest: snapshot.workspaceDigest,
      },
    };
  }
  throw new Error(`Unsupported mechanical evidence type: ${String(input.type)}`);
}
