import { existsSync } from 'node:fs';
import type { Adapter, AdapterStatus, AdapterStatusInspection } from './types.js';

const stateDefinitions = {
  managed: 'Every recorded output exists and matches its recorded checksum.',
  modified: 'At least one managed output differs from its recorded checksum.',
  unmanaged: 'A planned destination exists without a matching Harnessmith installation record.',
  partial: 'An installation record exists, but at least one recorded output is missing.',
  missing: 'No installation record or planned destination exists.',
  unsupported: 'No Adapter contract exists; stop before resolving or writing paths.',
  'host-dependent': 'Host-owned configuration and behavior require evidence from that Host.',
} as const;

type ObservedState = 'managed' | 'modified' | 'unmanaged' | 'partial' | 'missing';

interface SafeAction {
  code: string;
  command: string;
  automatic: false;
  destructive: false;
  requiresAuthorization: boolean;
}

function classify(status: AdapterStatus, plan: AdapterStatusInspection['plan']): ObservedState {
  if (status.installed) {
    if (status.outputs.some(({ status: value }) => value === 'missing')) return 'partial';
    if (status.outputs.some(({ status: value }) => value === 'modified')) return 'modified';
    return 'managed';
  }
  return plan.outputs.some(({ state }) => state === 'unmanaged') ? 'unmanaged' : 'missing';
}

function reasonCode(state: ObservedState) {
  return {
    managed: 'MANAGED_INSTALLATION',
    modified: 'MANAGED_OUTPUT_MODIFIED',
    unmanaged: 'UNMANAGED_TARGETS',
    partial: 'PARTIAL_INSTALLATION',
    missing: 'INSTALLATION_MISSING',
  }[state];
}

function action(code: string, command: string, requiresAuthorization = false): SafeAction {
  return { code, command, automatic: false, destructive: false, requiresAuthorization };
}

function safeActions(adapter: Adapter, state: ObservedState): SafeAction[] {
  const selector = `--agent ${adapter.name}${adapter.project ? ` --project ${adapter.project}` : ''}`;
  if (state === 'managed') {
    return [
      action('STATUS_RECHECK', `harnessmith status ${selector} --explain`),
      action('HOST_VERIFY', 'Verify behavior in a real Host session', true),
    ];
  }
  if (state === 'modified') {
    return [
      action('INSPECT_DIFF', `harnessmith status ${selector} --explain`),
      action('VERIFY_BACKUPS', `harnessmith restore ${selector} --dry-run`),
    ];
  }
  if (state === 'partial') {
    return [
      action('RESTORE_PREVIEW', `harnessmith restore ${selector} --dry-run`),
      action('SETUP_PREVIEW', `harnessmith setup ${selector} --dry-run`),
    ];
  }
  if (state === 'unmanaged') {
    return [action('INSPECT_OWNERSHIP', `harnessmith setup ${selector} --dry-run`)];
  }
  return [action('SETUP_PREVIEW', `harnessmith setup ${selector} --dry-run`)];
}

export function explainStatus({ adapter, status, record, plan }: AdapterStatusInspection) {
  const state = classify(status, plan);
  const backups = record
    ? [record.recordBackup, ...record.outputs.map(({ backup }) => backup)]
        .filter((path): path is string => Boolean(path))
        .map((path) => ({
          path,
          state: existsSync(path) ? ('present' as const) : ('missing' as const),
        }))
    : [];
  return {
    version: 1,
    command: 'status' as const,
    adapter: adapter.name,
    observedState: state,
    reasonCode: reasonCode(state),
    owner: 'harnessmith-installer' as const,
    risk:
      state === 'managed'
        ? ('low' as const)
        : state === 'missing'
          ? ('none' as const)
          : ('requires-review' as const),
    evidence: {
      record: { path: adapter.record, state: record ? ('present' as const) : ('missing' as const) },
      outputs: status.installed
        ? status.outputs
        : plan.outputs.map(({ path, state: outputState }) => ({ path, status: outputState })),
      backups,
    },
    actions: safeActions(adapter, state),
    boundaries: {
      harnessCapability: {
        state: 'supported' as const,
        owner: 'harnessmith-adapter' as const,
        evidence: adapter.capabilities,
      },
      hostConfiguration: {
        state: 'host-dependent' as const,
        owner: 'host' as const,
        reasonCode: 'HOST_CONFIGURATION_NOT_CHECKED' as const,
        conclusion: 'inconclusive' as const,
      },
      hostBehavior: {
        state: 'host-dependent' as const,
        owner: 'host' as const,
        reasonCode: 'REAL_HOST_BEHAVIOR_NOT_OBSERVED' as const,
        conclusion: 'inconclusive' as const,
      },
    },
    stateDefinitions,
  };
}

export function explainUnsupportedStatus(requestedAgents: string[]) {
  return {
    version: 1,
    command: 'status' as const,
    adapter: requestedAgents.join(',') || 'unknown',
    observedState: 'unsupported' as const,
    reasonCode: 'ADAPTER_UNSUPPORTED' as const,
    owner: 'none' as const,
    risk: 'unsupported' as const,
    evidence: { requestedAgents },
    actions: [action('LIST_SUPPORTED_ADAPTERS', 'harnessmith capabilities --json')],
    boundaries: {
      harnessCapability: {
        state: 'unsupported' as const,
        owner: 'none' as const,
        evidence: null,
      },
      hostConfiguration: {
        state: 'host-dependent' as const,
        owner: 'host' as const,
        reasonCode: 'HOST_CONFIGURATION_NOT_CHECKED' as const,
        conclusion: 'inconclusive' as const,
      },
      hostBehavior: {
        state: 'host-dependent' as const,
        owner: 'host' as const,
        reasonCode: 'REAL_HOST_BEHAVIOR_NOT_OBSERVED' as const,
        conclusion: 'inconclusive' as const,
      },
    },
    stateDefinitions,
  };
}

export type StatusExplanation =
  | ReturnType<typeof explainStatus>
  | ReturnType<typeof explainUnsupportedStatus>;
