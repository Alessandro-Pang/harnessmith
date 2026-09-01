import type { Readable, Writable } from 'node:stream';
import { confirm, intro, isCancel, log, multiselect, note, outro } from '@clack/prompts';
import pc from 'picocolors';
import type { AdoptReport } from './adopt.js';
import { supportedAgents } from './agents.js';
import type { SetupGuide, SetupVerification } from './setup.js';
import type { StatusExplanation } from './status-explanation.js';
import type { AdapterStatus, InstallPlan, InstallResult, Io } from './types.js';

type PromptInput = Readable & { isTTY?: boolean };
type PromptOutput = Writable & { isTTY?: boolean };

function stopOnCancel<T>(value: T | symbol): T {
  if (isCancel(value)) throw new Error('Operation cancelled');
  return value;
}

export async function selectAgents({
  input = process.stdin,
  output = process.stdout,
}: {
  input?: PromptInput;
  output?: PromptOutput;
} = {}): Promise<string[]> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Agent selection is required in non-interactive mode: --agent <name>');
  }
  return stopOnCancel(
    await multiselect({
      message: 'Which coding agents should Harnessmith configure?',
      options: supportedAgents,
      initialValues: ['codex'],
      required: true,
      input,
      output,
    }),
  );
}

export async function confirmConflicts(
  plans: InstallPlan[],
  {
    input = process.stdin,
    output = process.stdout,
  }: { input?: PromptInput; output?: PromptOutput } = {},
): Promise<boolean> {
  const conflicts = plans.flatMap((plan) =>
    plan.outputs
      .filter(({ action }) => action === 'conflict')
      .map(({ path }) => ({ adapter: plan.adapter, path })),
  );
  if (conflicts.length === 0) return false;
  note(
    conflicts.map(({ adapter, path }) => `${pc.yellow(adapter)}  ${path}`).join('\n'),
    'Existing or modified files',
    { output },
  );
  return stopOnCancel(
    await confirm({
      message: `Back up and replace ${conflicts.length} conflicting target${conflicts.length === 1 ? '' : 's'}?`,
      initialValue: false,
      input,
      output,
    }),
  );
}

export async function confirmSetup({
  input = process.stdin,
  output = process.stdout,
}: {
  input?: PromptInput;
  output?: PromptOutput;
} = {}): Promise<boolean> {
  const value = await confirm({
    message: 'Install exactly this plan and run deterministic post-install health checks?',
    initialValue: false,
    input,
    output,
  });
  return isCancel(value) ? false : value;
}

export async function confirmAdopt(
  report: AdoptReport,
  {
    input = process.stdin,
    output = process.stdout,
  }: { input?: PromptInput; output?: PromptOutput } = {},
): Promise<boolean> {
  const value = await confirm({
    message: `Apply proposal ${report.proposalId} with ${report.backups.length} exact backup target(s)?`,
    initialValue: false,
    input,
    output,
  });
  return isCancel(value) ? false : value;
}

export function startInteractive(output: PromptOutput): void {
  intro(pc.bgCyan(pc.black(' Harnessmith ')), { output });
}

export function finishInteractive(message: string, output: PromptOutput): void {
  outro(message, { output });
}

export function printPlans(plans: InstallPlan[], io: Io = console): void {
  for (const plan of plans) {
    io.log(`${pc.bold(plan.adapter)}  ${pc.dim(plan.home)}`);
    for (const { path, action } of plan.outputs) {
      const label = action.padEnd(15);
      const state =
        action === 'conflict'
          ? pc.yellow(label)
          : action === 'create'
            ? pc.green(label)
            : pc.cyan(label);
      io.log(`  ${state} ${path}`);
    }
  }
}

export function printSetupGuide(guide: SetupGuide, io: Io = console): void {
  printPlans(guide.adapters, io);
  io.log('  will not change');
  for (const boundary of guide.willNotChange) io.log(`    - ${boundary}`);
  io.log(`  recovery preview  ${guide.recovery.restore}`);
  io.log(`  real Host behavior  ${guide.hostBehavior.status}`);
}

export function printAdoptPlan(report: AdoptReport, io: Io = console): void {
  io.log(`Adopt proposal ${report.proposalId}`);
  for (const item of report.inventory) {
    io.log(`  ${item.classification}  ${item.path}  ${item.reasonCode}`);
  }
  if (report.diff) io.log(report.diff);
  for (const backup of report.backups) io.log(`  backup  ${backup.source} -> ${backup.path}`);
}

export function printSetupVerification(verification: SetupVerification, io: Io = console): void {
  for (const item of verification) {
    io.log(
      `${item.adapter}: ownership=${item.ownership}, runtime-health=${item.runtimeHealth}, real-host=not-verified`,
    );
  }
}

export function printStatuses(statuses: AdapterStatus[], io: Io = console): void {
  for (const status of statuses) {
    io.log(
      `${pc.bold(status.adapter)}  ${status.installed ? pc.green('installed') : pc.dim('not installed')}`,
    );
    for (const output of status.outputs) {
      const label = output.status.padEnd(12);
      const state =
        output.status === 'managed'
          ? pc.green(label)
          : output.status === 'modified'
            ? pc.yellow(label)
            : pc.red(label);
      io.log(`  ${state} ${output.path}`);
    }
  }
}

export function printStatusExplanations(explanations: StatusExplanation[], io: Io = console): void {
  for (const explanation of explanations) {
    io.log(
      `${explanation.adapter}: state=${explanation.observedState}, reason=${explanation.reasonCode}, owner=${explanation.owner}`,
    );
    for (const next of explanation.actions) {
      io.log(`  next ${next.code}  ${next.command} (not executed automatically)`);
    }
    io.log(
      `  Host behavior: ${explanation.boundaries.hostBehavior.conclusion} (${explanation.boundaries.hostBehavior.reasonCode})`,
    );
  }
}

export function printInstallResults(
  results: InstallResult[],
  io: Io = console,
  {
    interactive = false,
    output = process.stdout,
  }: { interactive?: boolean; output?: PromptOutput } = {},
): void {
  for (const result of results) {
    if (interactive) log.success(`${result.adapter} installed in ${result.home}`, { output });
    else io.log(`Installed ${result.adapter}: ${result.home}`);
    for (const path of result.instructions) io.log(`  ${pc.dim('instructions')} ${path}`);
    io.log(`  ${pc.dim('harness')}      ${result.harness}`);
    for (const { backup } of result.backups) io.log(`  ${pc.yellow('backup')}       ${backup}`);
  }
  if (results[0]?.initialization) {
    if (interactive) log.info(results[0].initialization, { output });
    else io.log(results[0].initialization);
  }
}
