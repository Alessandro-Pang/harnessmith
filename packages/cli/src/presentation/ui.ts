import type { Readable, Writable } from 'node:stream';
import { confirm, intro, isCancel, log, multiselect, note, outro } from '@clack/prompts';
import pc from 'picocolors';
import type { InstallPlan, InstallResult, Io } from '../shared/types.js';
import { printPlans } from './print.js';

type PromptInput = Readable & { isTTY?: boolean };
type PromptOutput = Writable & { isTTY?: boolean };

/**
 * Presentation-owned structural view types. The UI reads only these shapes, so it does not
 * import adoption/setup/status domain types; callers pass their richer report objects, which
 * remain structurally assignable. This keeps the presentation layer free of domain backflow.
 */
interface FirstValueStateView {
  status: string;
}

interface FirstValueView {
  states: {
    installed: FirstValueStateView;
    healthy: FirstValueStateView;
    hostConfigured: FirstValueStateView;
    hostVerified: FirstValueStateView;
  };
  nextAction: { code: string; command: string };
}

interface AgentOption {
  value: string;
  label: string;
  hint: string;
}

interface AdoptPlanView {
  proposalId: string;
  inventory: ReadonlyArray<{ classification: string; path: string; reasonCode: string }>;
  diff: string | null;
  backups: ReadonlyArray<{ source: string; path: string }>;
}

interface SetupGuideView {
  adapters: InstallPlan[];
  willNotChange: string[];
  recovery: { restore: string };
  hostBehavior: { status: string };
  firstValue: FirstValueView;
}

type SetupVerificationView = ReadonlyArray<{
  adapter: string;
  ownership: string;
  runtimeHealth: string;
}>;

interface StatusExplanationView {
  adapter: string;
  observedState: string;
  reasonCode: string;
  owner: string;
  actions: ReadonlyArray<{ code: string; command: string }>;
  boundaries: { hostBehavior: { conclusion: string; reasonCode: string } };
  firstValue: FirstValueView;
}

function printFirstValue(firstValue: FirstValueView, io: Io): void {
  const { installed, healthy, hostConfigured, hostVerified } = firstValue.states;
  io.log(
    `  First Value: installed=${installed.status}, healthy=${healthy.status}, host-configured=${hostConfigured.status}, host-verified=${hostVerified.status}`,
  );
  io.log(`  First Value next ${firstValue.nextAction.code}  ${firstValue.nextAction.command}`);
}

function stopOnCancel<T>(value: T | symbol): T {
  if (isCancel(value)) throw new Error('Operation cancelled');
  return value;
}

export async function selectAgents({
  agents,
  input = process.stdin,
  output = process.stdout,
}: {
  agents: AgentOption[];
  input?: PromptInput;
  output?: PromptOutput;
}): Promise<string[]> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Agent selection is required in non-interactive mode: --agent <name>');
  }
  return stopOnCancel(
    await multiselect({
      message: 'Which coding agents should Harnessmith configure?',
      options: agents,
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
  report: AdoptPlanView,
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

export { printLifecyclePlans, printPlans, printStatuses } from './print.js';

export function printSetupGuide(guide: SetupGuideView, io: Io = console): void {
  printPlans(guide.adapters, io);
  io.log('  will not change');
  for (const boundary of guide.willNotChange) io.log(`    - ${boundary}`);
  io.log(`  recovery preview  ${guide.recovery.restore}`);
  io.log(`  real Host behavior  ${guide.hostBehavior.status}`);
  printFirstValue(guide.firstValue, io);
}

export function printAdoptPlan(report: AdoptPlanView, io: Io = console): void {
  io.log(`Adopt proposal ${report.proposalId}`);
  for (const item of report.inventory) {
    io.log(`  ${item.classification}  ${item.path}  ${item.reasonCode}`);
  }
  if (report.diff) io.log(report.diff);
  for (const backup of report.backups) io.log(`  backup  ${backup.source} -> ${backup.path}`);
}

export function printSetupVerification(
  verification: SetupVerificationView,
  io: Io = console,
): void {
  for (const item of verification) {
    io.log(
      `${item.adapter}: ownership=${item.ownership}, runtime-health=${item.runtimeHealth}, real-host=not-verified`,
    );
  }
}

export function printStatusExplanations(
  explanations: StatusExplanationView[],
  io: Io = console,
): void {
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
    printFirstValue(explanation.firstValue, io);
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
    for (const { backup } of result.backups) io.log(`  ${pc.yellow('backup')}       ${backup}`);
  }
  if (results[0]?.initialization) {
    if (interactive) log.info(results[0].initialization, { output });
    else io.log(results[0].initialization);
  }
}
