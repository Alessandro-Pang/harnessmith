import {
  collectDiagnosticAdapter,
  type DiagnosticFailure,
  diagnosticsCommandTimeoutMs,
  diagnosticsMaxCommandBytes,
} from './diagnostics-runtime.js';
import { packageVersion } from '../installation/install-template.js';
import type { Adapter } from '../shared/types.js';

export function createDiagnosticsReport(
  adapters: Adapter[],
  {
    env = process.env,
    project = process.cwd(),
  }: { env?: NodeJS.ProcessEnv; project?: string } = {},
) {
  const failures: DiagnosticFailure[] = [];
  const collected = adapters.map((adapter) =>
    collectDiagnosticAdapter(adapter, env, project, failures),
  );
  const truncated = collected.some((adapter) => adapter.truncated);
  const adaptersReport = collected.map(({ truncated: _truncated, ...adapter }) => ({
    ...adapter,
    subsystems: [
      ...adapter.subsystems,
      {
        id: 'host',
        status: 'inconclusive' as const,
        reasonCode: 'REAL_HOST_NOT_OBSERVED',
        artifactDigest: null,
      },
    ],
  }));
  return {
    version: 1,
    command: 'diagnostics' as const,
    collectionResult:
      failures.length === 0
        ? ('complete' as const)
        : adapters.length > 0
          ? ('partial' as const)
          : ('inconclusive' as const),
    privacy: { uploaded: false, persisted: false, previewOnly: true },
    budget: {
      maxAdapters: 5,
      maxCommandBytes: diagnosticsMaxCommandBytes,
      timeoutMs: diagnosticsCommandTimeoutMs,
      truncated,
    },
    package: { version: packageVersion },
    adapters: adaptersReport,
    failures,
    verification: [
      'harnessmith diagnostics --agent <agent> --json',
      'node <harness-path>/bin/harness.mjs health --json',
    ],
  };
}

export type DiagnosticsReport = ReturnType<typeof createDiagnosticsReport>;
