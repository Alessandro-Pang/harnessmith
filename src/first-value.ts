import type { Adapter } from './types.js';

type FirstValueStatus = 'passed' | 'failed' | 'not-checked' | 'inconclusive';

interface VerificationItem {
  ownership: 'managed' | 'failed';
  runtimeHealth: 'passed' | 'failed' | 'skipped';
}

function state(status: FirstValueStatus, owner: string, reasonCode: string) {
  return { status, owner, reasonCode };
}

function base(states: { installed: ReturnType<typeof state>; healthy: ReturnType<typeof state> }) {
  return {
    version: 1,
    start: 'positioning' as const,
    end: 'host-verified' as const,
    firstValueAchieved: false,
    states: {
      ...states,
      hostConfigured: state('inconclusive', 'host', 'HOST_CONFIGURATION_NOT_OBSERVED'),
      hostVerified: state('inconclusive', 'host-and-user', 'CONTROLLED_HOST_TASK_NOT_OBSERVED'),
    },
    telemetry: {
      uploaded: false,
      remoteEvidenceUsed: false,
      activityInferredFromDownloadsOrTraffic: false,
    },
  };
}

function selector(adapters: Adapter[]): string {
  return adapters.map(({ name }) => name).join(',');
}

export function firstValuePreview(adapters: Adapter[]) {
  const agents = selector(adapters);
  return {
    ...base({
      installed: state('not-checked', 'harnessmith-installer', 'INSTALL_NOT_RUN'),
      healthy: state('not-checked', 'embedded-runtime', 'HEALTH_NOT_RUN'),
    }),
    currentStage: 'previewed' as const,
    nextAction: {
      code: 'CONFIRM_INSTALL' as const,
      command: `harnessmith setup --agent ${agents} --yes`,
      owner: 'user' as const,
    },
    recovery: {
      status: 'presented' as const,
      owner: 'user' as const,
      inspect: `harnessmith status --agent ${agents} --explain`,
      restore: `harnessmith restore --agent ${agents} --dry-run`,
    },
  };
}

export function firstValueFromSetupVerification(verification: VerificationItem[]) {
  const installed = verification.every(({ ownership }) => ownership === 'managed');
  const healthy = verification.every(({ runtimeHealth }) => runtimeHealth === 'passed');
  const stage = healthy ? 'healthy' : installed ? 'installed' : 'previewed';
  return {
    ...base({
      installed: state(
        installed ? 'passed' : 'failed',
        'harnessmith-installer',
        installed ? 'MANAGED_INSTALLATION' : 'INSTALLATION_NOT_MANAGED',
      ),
      healthy: state(
        healthy
          ? 'passed'
          : verification.some(({ runtimeHealth }) => runtimeHealth === 'skipped')
            ? 'not-checked'
            : 'failed',
        'embedded-runtime',
        healthy
          ? 'DETERMINISTIC_HEALTH_PASSED'
          : verification.some(({ runtimeHealth }) => runtimeHealth === 'skipped')
            ? 'DETERMINISTIC_HEALTH_SKIPPED'
            : 'DETERMINISTIC_HEALTH_FAILED',
      ),
    }),
    currentStage: stage,
    nextAction: {
      code: healthy ? ('RUN_CONTROLLED_HOST_TASK' as const) : ('INSPECT_STATUS' as const),
      command: healthy
        ? 'Run the documented read-only first task in the selected real Host and retain verifier evidence.'
        : 'harnessmith status --agent <agent> --explain',
      owner: healthy ? ('host-and-user' as const) : ('user' as const),
    },
    recovery: {
      status: 'presented' as const,
      owner: 'user' as const,
      inspect: 'harnessmith status --agent <agent> --explain',
      restore: 'harnessmith restore --agent <agent> --dry-run',
    },
  };
}

export function firstValueFromStatus(
  observedState: 'managed' | 'modified' | 'unmanaged' | 'partial' | 'missing' | 'unsupported',
  adapter: string,
) {
  const installed = observedState === 'managed';
  const missing = observedState === 'missing';
  const unsupported = observedState === 'unsupported';
  return {
    ...base({
      installed: state(
        installed ? 'passed' : 'failed',
        'harnessmith-installer',
        installed ? 'MANAGED_INSTALLATION' : `INSTALLATION_${observedState.toUpperCase()}`,
      ),
      healthy: state('not-checked', 'embedded-runtime', 'STATUS_DOES_NOT_RUN_HEALTH'),
    }),
    currentStage: installed ? ('installed' as const) : ('positioning' as const),
    nextAction: {
      code: installed
        ? ('RUN_DIAGNOSTICS' as const)
        : unsupported
          ? ('LIST_SUPPORTED_ADAPTERS' as const)
          : missing
            ? ('PREVIEW_SETUP' as const)
            : ('INSPECT_STATUS' as const),
      command: installed
        ? `harnessmith diagnostics --agent ${adapter} --json`
        : unsupported
          ? 'harnessmith capabilities --json'
          : missing
            ? `harnessmith setup --agent ${adapter} --dry-run --json`
            : `harnessmith status --agent ${adapter} --explain`,
      owner: 'user' as const,
    },
    recovery: {
      status: 'presented' as const,
      owner: 'user' as const,
      inspect: `harnessmith status --agent ${adapter} --explain`,
      restore: `harnessmith restore --agent ${adapter} --dry-run`,
    },
  };
}
