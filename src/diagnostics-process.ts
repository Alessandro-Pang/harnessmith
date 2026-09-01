import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Adapter } from './types.js';

export const diagnosticsMaxCommandBytes = 256 * 1024;
export const diagnosticsCommandTimeoutMs = 10_000;

export interface DiagnosticCommandResult {
  status: 'collected' | 'inconclusive';
  reasonCode: string;
  digest: string | null;
  value: unknown;
  truncated: boolean;
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function runDiagnosticJson(
  adapter: Adapter,
  args: string[],
  env: NodeJS.ProcessEnv,
  project: string,
): DiagnosticCommandResult {
  const result = spawnSync(
    process.execPath,
    [join(adapter.harness, 'bin', 'harness.mjs'), ...args],
    {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: diagnosticsCommandTimeoutMs,
      maxBuffer: diagnosticsMaxCommandBytes,
      windowsHide: true,
    },
  );
  const output = result.stdout || '';
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const truncated = errorCode === 'ENOBUFS';
  if (result.error || !output.trim()) {
    return {
      status: 'inconclusive',
      reasonCode: truncated
        ? 'COLLECTION_BUDGET_EXCEEDED'
        : errorCode === 'ETIMEDOUT'
          ? 'COLLECTION_TIMEOUT'
          : 'COMMAND_OUTPUT_UNAVAILABLE',
      digest: output ? digest(output) : null,
      value: null,
      truncated,
    };
  }
  try {
    return {
      status: 'collected',
      reasonCode: result.status === 0 ? 'COMMAND_COMPLETED' : 'COMMAND_REPORTED_FAILURE',
      digest: digest(output),
      value: JSON.parse(output),
      truncated,
    };
  } catch {
    return {
      status: 'inconclusive',
      reasonCode: 'INVALID_JSON_OUTPUT',
      digest: digest(output),
      value: null,
      truncated,
    };
  }
}
