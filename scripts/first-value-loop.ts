import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from '../src/adapters.js';
import { installAll } from '../src/install.js';
import { describeLifecycle } from '../src/lifecycle-plan.js';
import { createSetupGuide, setupVerificationPassed, verifySetup } from '../src/setup.js';
import { explainStatus } from '../src/status-explanation.js';
import { inspectStatusAll } from '../src/status-inspection.js';

export function runFirstValueLoop() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-first-value-loop-'));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'first-value-fixture',
  };
  try {
    const adapter = createAdapter('codex', { env });
    const options = { agent: ['codex'], project: root, json: true, yes: true };
    const guide = createSetupGuide([adapter], options);
    installAll([adapter], { env });
    const verification = verifySetup([adapter], options, env);
    const explanation = explainStatus(inspectStatusAll([adapter])[0]);
    const recovery = describeLifecycle('restore', adapter, false);
    const localPassed =
      guide.phase === 'preview' &&
      setupVerificationPassed(verification) &&
      explanation.observedState === 'managed' &&
      recovery.layers.length > 0;
    return {
      schemaVersion: 1,
      scenarioId: 'first-value-loop',
      scenarioVersion: 1,
      result: localPassed ? ('local-baseline-passed' as const) : ('local-baseline-failed' as const),
      states: {
        positioning: 'passed' as const,
        hostSelected: 'passed' as const,
        previewed: guide.phase === 'preview' ? ('passed' as const) : ('failed' as const),
        installed: verification.every(({ ownership }) => ownership === 'managed')
          ? ('passed' as const)
          : ('failed' as const),
        healthy: setupVerificationPassed(verification) ? ('passed' as const) : ('failed' as const),
        controlledTaskReady: 'passed' as const,
        hostConfigured: 'inconclusive' as const,
        hostVerified: 'inconclusive' as const,
        recoveryAware: recovery.layers.length > 0 ? ('passed' as const) : ('failed' as const),
      },
      firstValueAchieved: false,
      telemetry: {
        uploaded: false,
        remoteEvidenceUsed: false,
      },
      evidence: [
        'SETUP_PREVIEW_GENERATED',
        'MANAGED_INSTALLATION_OBSERVED',
        'DETERMINISTIC_HEALTH_PASSED',
        'STATUS_EXPLANATION_OBSERVED',
        'RESTORE_PREVIEW_AVAILABLE',
      ],
      excludedActivityClaims: [
        'NPM_DOWNLOADS_ARE_NOT_ACTIVE_USERS',
        'GITHUB_TRAFFIC_IS_NOT_ACTIVE_USERS',
        'LOCAL_TESTS_ARE_NOT_ACTIVE_USERS',
      ],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main(): void {
  process.stdout.write(`${JSON.stringify(runFirstValueLoop())}\n`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
