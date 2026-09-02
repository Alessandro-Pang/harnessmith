import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DiagnosticCommandResult,
  diagnosticsCommandTimeoutMs,
  diagnosticsMaxCommandBytes,
  runDiagnosticJson,
} from './diagnostics-process.js';
import { inspectStatusAll } from '../status/status-inspection.js';
import type { Adapter, AdapterStatusInspection } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';

export { diagnosticsCommandTimeoutMs, diagnosticsMaxCommandBytes };

const knownHealthChecks = new Set([
  'runtime',
  'installation',
  'global-memory',
  'project-memory',
  'audit',
]);

type DiagnosticStatus = 'passed' | 'warning' | 'failed' | 'inconclusive';
type DiagnosticSource = 'installation' | 'health' | 'task' | 'routing';

export interface DiagnosticFailure {
  adapter: string;
  source: DiagnosticSource;
  errorCode: string;
  result: 'inconclusive';
}

function installationSummary(inspection: AdapterStatusInspection) {
  const { status, plan } = inspection;
  const states = status.installed
    ? status.outputs.map(({ status: value }) => value)
    : plan.outputs.map(({ state }) => state);
  const counts = { managed: 0, modified: 0, missing: 0, unmanaged: 0 };
  for (const state of states) {
    if (state in counts) counts[state as keyof typeof counts] += 1;
  }
  const observed = status.installed
    ? counts.missing > 0
      ? 'partial'
      : counts.modified > 0
        ? 'modified'
        : 'managed'
    : counts.unmanaged > 0
      ? 'unmanaged'
      : 'missing';
  return {
    status: observed,
    reasonCode: `INSTALLATION_${observed.toUpperCase()}`,
    outputCounts: counts,
  };
}

function unavailableSubsystems(reasonCode: string) {
  return ['memory', 'task', 'routing'].map((id) => ({
    id,
    status: 'inconclusive' as const,
    reasonCode,
    artifactDigest: null,
  }));
}

function recordFailures(
  adapter: Adapter,
  commands: readonly (readonly [
    Exclude<DiagnosticSource, 'installation'>,
    DiagnosticCommandResult,
  ])[],
  failures: DiagnosticFailure[],
): void {
  for (const [source, result] of commands) {
    if (
      result.status === 'inconclusive' &&
      result.reasonCode !== 'PROJECT_MEMORY_NOT_INITIALIZED'
    ) {
      failures.push({
        adapter: adapter.name,
        source,
        errorCode: result.reasonCode,
        result: 'inconclusive',
      });
    }
  }
}

function summarizeRuntime(
  adapter: Adapter,
  env: NodeJS.ProcessEnv,
  project: string,
  failures: DiagnosticFailure[],
) {
  const health = runDiagnosticJson(adapter, ['health', '--json'], env, project);
  const task = existsSync(join(project, '.agent-docs'))
    ? runDiagnosticJson(adapter, ['task', 'status', '--project', project, '--json'], env, project)
    : {
        status: 'inconclusive' as const,
        reasonCode: 'PROJECT_MEMORY_NOT_INITIALIZED',
        digest: null,
        value: null,
        truncated: false,
      };
  const routing = runDiagnosticJson(adapter, ['route', 'diagnose', '--json'], env, project);
  const commands = [
    ['health', health],
    ['task', task],
    ['routing', routing],
  ] as const;
  recordFailures(adapter, commands, failures);

  const rawChecks =
    health.status === 'collected' &&
    health.value &&
    typeof health.value === 'object' &&
    Array.isArray((health.value as { checks?: unknown }).checks)
      ? (health.value as { checks: unknown[] }).checks
      : [];
  const runtimeChecks = rawChecks.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const check = value as { id?: unknown; status?: unknown };
    if (
      typeof check.id !== 'string' ||
      !knownHealthChecks.has(check.id) ||
      !['passed', 'warning', 'failed'].includes(String(check.status))
    ) {
      return [];
    }
    return [{ id: check.id, status: check.status as Exclude<DiagnosticStatus, 'inconclusive'> }];
  });
  const memoryChecks = runtimeChecks.filter(({ id }) => id.includes('memory'));
  const memoryStatus: DiagnosticStatus =
    health.status === 'inconclusive'
      ? 'inconclusive'
      : memoryChecks.some(({ status }) => status === 'failed')
        ? 'failed'
        : memoryChecks.some(({ status }) => status === 'warning')
          ? 'warning'
          : memoryChecks.length > 0
            ? 'passed'
            : 'inconclusive';
  const taskValue = Array.isArray(task.value) ? task.value : null;
  const routeValue =
    routing.value && typeof routing.value === 'object'
      ? (routing.value as { routes?: unknown }).routes
      : null;
  return {
    runtimeChecks,
    subsystems: [
      {
        id: 'memory',
        status: memoryStatus,
        reasonCode: health.reasonCode,
        artifactDigest: health.digest,
      },
      {
        id: 'task',
        status: taskValue ? ('passed' as const) : ('inconclusive' as const),
        reasonCode: task.reasonCode,
        artifactDigest: task.digest,
      },
      {
        id: 'routing',
        status: Array.isArray(routeValue) ? ('passed' as const) : ('inconclusive' as const),
        reasonCode: routing.reasonCode,
        artifactDigest: routing.digest,
      },
    ],
    truncated: commands.some(([, result]) => result.truncated),
  };
}

export function collectDiagnosticAdapter(
  adapter: Adapter,
  env: NodeJS.ProcessEnv,
  project: string,
  failures: DiagnosticFailure[],
) {
  const capability = {
    scope: adapter.capabilities.scope,
    instructionFormat: adapter.capabilities.instructionFormat,
    nativeRuleActivation: adapter.capabilities.nativeRuleActivation,
  };
  try {
    const inspection = inspectStatusAll([adapter])[0];
    const installation = installationSummary(inspection);
    const canRun =
      installation.status === 'managed' && existsSync(join(adapter.harness, 'bin', 'harness.mjs'));
    const runtime = canRun
      ? summarizeRuntime(adapter, env, project, failures)
      : {
          runtimeChecks: [],
          subsystems: unavailableSubsystems('MANAGED_RUNTIME_UNAVAILABLE'),
          truncated: false,
        };
    return { adapter: adapter.name, capability, installation, ...runtime };
  } catch (error) {
    const errorCode = error instanceof HarnessmithError ? error.code : 'INTERNAL_ERROR';
    failures.push({
      adapter: adapter.name,
      source: 'installation',
      errorCode,
      result: 'inconclusive',
    });
    return {
      adapter: adapter.name,
      capability,
      installation: {
        status: 'inconclusive' as const,
        reasonCode: errorCode,
        outputCounts: { managed: 0, modified: 0, missing: 0, unmanaged: 0 },
      },
      runtimeChecks: [],
      subsystems: unavailableSubsystems('INSTALLATION_INSPECTION_INCONCLUSIVE'),
      truncated: false,
    };
  }
}
