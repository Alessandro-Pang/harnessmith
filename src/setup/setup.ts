import { join } from 'node:path';
import { execaSync } from 'execa';
import { firstValuePreview } from './first-value.js';
import { statusAll } from '../installation/lifecycle.js';
import { describeInstall } from '../installation/records.js';
import type { Adapter, CliOptions } from '../shared/types.js';

const stateDefinitions = {
  managed: 'Owned by Harnessmith and unchanged; safe to replace transactionally.',
  unmanaged:
    'Exists without a matching Harnessmith ownership record; refused unless --force is explicit.',
  modified:
    'Was managed but differs from the recorded checksum; refused unless --force is explicit.',
  unsupported:
    'No built-in Adapter contract exists; setup stops before resolving or writing paths.',
  'host-dependent':
    'Model behavior, tool permissions, authentication, and runtime events remain owned by the Host.',
} as const;

export function createSetupGuide(adapters: Adapter[], options: CliOptions) {
  const plans = adapters.map((adapter) => ({
    ...describeInstall(adapter),
    initializeGlobalMemory: options.initGlobal !== false,
  }));
  const agents = adapters.map(({ name }) => name).join(',');
  return {
    version: 1,
    command: 'setup' as const,
    phase: 'preview' as const,
    requiresConfirmation: true,
    adapters: plans,
    stateDefinitions,
    willChange: plans.flatMap((plan) =>
      plan.outputs.map(({ path, action, state }) => ({
        adapter: plan.adapter,
        path,
        action,
        state,
      })),
    ),
    willNotChange: [
      'Host authentication, models, tool permissions, and remote services.',
      'Unrelated project files and personal overlay content outside managed destinations.',
      'Unmanaged or modified targets unless --force is explicitly supplied.',
    ],
    recovery: {
      inspect: `harnessmith status --agent ${agents} --json`,
      restore: `harnessmith restore --agent ${agents} --dry-run`,
      uninstall: `harnessmith uninstall --agent ${agents} --dry-run`,
    },
    hostBehavior: {
      status: 'not-verified' as const,
      reason: 'Installation and deterministic health do not prove behavior in a real Host session.',
    },
    minimalExample: {
      prompt:
        'Perform a read-only analysis of this repository, cite current fact sources, and report unverified scope without changing files.',
    },
    firstValue: firstValuePreview(adapters),
  };
}

function parseHealth(stdout: string): { healthy?: boolean; checks?: unknown[] } | null {
  try {
    const value: unknown = JSON.parse(stdout.trim());
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { healthy?: boolean; checks?: unknown[] })
      : null;
  } catch {
    return null;
  }
}

export function verifySetup(adapters: Adapter[], options: CliOptions, env: NodeJS.ProcessEnv) {
  const statuses = statusAll(adapters);
  return adapters.map((adapter, index) => {
    const status = statuses[index];
    const ownership =
      status?.installed && status.outputs.every(({ status: value }) => value === 'managed')
        ? ('managed' as const)
        : ('failed' as const);
    const healthCommand = `${process.execPath} ${join(adapter.harness, 'bin', 'harness.mjs')} health --json`;
    if (options.initGlobal === false) {
      return {
        adapter: adapter.name,
        ownership,
        runtimeHealth: 'skipped' as const,
        healthCommand,
        reason: 'Global Memory initialization was explicitly skipped.',
      };
    }
    const result = execaSync(
      process.execPath,
      [join(adapter.harness, 'bin', 'harness.mjs'), 'health', '--json'],
      {
        cwd: adapter.project ?? env.HOME ?? process.cwd(),
        env,
        maxBuffer: 1024 * 1024,
        reject: false,
      },
    );
    const health = parseHealth(result.stdout);
    return {
      adapter: adapter.name,
      ownership,
      runtimeHealth:
        result.exitCode === 0 && health?.healthy === true
          ? ('passed' as const)
          : ('failed' as const),
      healthCommand,
      health,
    };
  });
}

export function setupVerificationPassed(verification: ReturnType<typeof verifySetup>): boolean {
  return verification.every(
    ({ ownership, runtimeHealth }) =>
      ownership === 'managed' && ['passed', 'skipped'].includes(runtimeHealth),
  );
}

export type SetupGuide = ReturnType<typeof createSetupGuide>;
export type SetupVerification = ReturnType<typeof verifySetup>;
