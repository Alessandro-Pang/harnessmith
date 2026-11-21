import { join } from 'node:path';
import { execaSync } from 'execa';
import { templateRoot } from '../installation/install-template.js';
import { sha256Prefixed } from '../shared/files.js';

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
  return sha256Prefixed(value);
}

export function runDiagnosticJson(
  args: string[],
  env: NodeJS.ProcessEnv,
  project: string,
): DiagnosticCommandResult {
  const result = execaSync(
    process.execPath,
    [join(templateRoot, 'bin', 'harnessmith.mjs'), ...args],
    {
      cwd: project,
      env,
      encoding: 'utf8',
      extendEnv: false,
      timeout: diagnosticsCommandTimeoutMs,
      maxBuffer: diagnosticsMaxCommandBytes,
      reject: false,
      stdin: 'ignore',
      stripFinalNewline: false,
      windowsHide: true,
    },
  );
  const output = result.stdout || '';
  const truncated = result.isMaxBuffer;
  // A normal non-zero exit still carries usable output; only spawn/system failures
  // (timeout, buffer overflow, no exit code) or empty output are inconclusive.
  const spawnFailed = result.timedOut || truncated || result.exitCode === undefined;
  if (spawnFailed || !output.trim()) {
    return {
      status: 'inconclusive',
      reasonCode: truncated
        ? 'COLLECTION_BUDGET_EXCEEDED'
        : result.timedOut
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
      reasonCode: result.exitCode === 0 ? 'COMMAND_COMPLETED' : 'COMMAND_REPORTED_FAILURE',
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
