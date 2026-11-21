import { existsSync } from 'node:fs';
import { adapterCapabilities, createAdapter } from '../adapters/adapters.js';
import { normalizeAgents, supportedAgents } from '../adapters/agent-selection.js';
import { executeAdopt } from '../adoption/adopt-command.js';
import type { HarnessmithCommand } from '../app/program.js';
import { executeDiagnostics } from '../diagnostics/diagnostics-command.js';
import { installWithSkills, uninstallWithSkills } from '../installation/installation-workflow.js';
import { restoreAll } from '../installation/lifecycle.js';
import { describeLifecycle } from '../installation/lifecycle-plan.js';
import { assertNonOverlappingAdapters, describeInstall } from '../installation/records.js';
import {
  confirmConflicts,
  finishInteractive,
  printInstallResults,
  printLifecyclePlans,
  printPlans,
  printStatusExplanations,
  printStatuses,
  selectAgents,
} from '../presentation/ui.js';
import { executeSetup } from '../setup/setup-command.js';
import type { LifecycleCommand } from '../shared/lifecycle-types.js';
import type { Adapter, CliOptions, ExecuteContext } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { explainStatus, explainUnsupportedStatus } from '../status/status-explanation.js';
import { inspectStatusAll, statusAll } from '../status/status-inspection.js';
import type { AdapterCommand } from './command-routing.js';

export function isTty(stream: ExecuteContext['input'] | ExecuteContext['output']): boolean {
  return 'isTTY' in stream && stream.isTTY === true;
}
async function resolveAdapters(options: CliOptions, context: ExecuteContext): Promise<Adapter[]> {
  let requested = options.agent;
  if (requested.length === 0 && options.yes) requested = ['codex'];
  if (requested.length === 0 && isTty(context.input) && isTty(context.output) && !options.json) {
    requested = await selectAgents({
      agents: supportedAgents,
      input: context.input,
      output: context.output,
    });
  }
  if (requested.length === 0) {
    throw new HarnessmithError(
      'CLI_USAGE',
      'Agent selection is required in non-interactive mode: --agent <name>',
      2,
    );
  }
  const agents = normalizeAgents(requested);
  if (agents.length === 0) throw new HarnessmithError('CLI_USAGE', 'Select at least one agent', 2);
  const adapters = agents.map((name) =>
    createAdapter(name, { env: context.env, project: options.project }),
  );
  assertNonOverlappingAdapters(adapters);
  return adapters;
}

function installedPeerAdapters(
  adapters: Adapter[],
  options: CliOptions,
  context: ExecuteContext,
): Adapter[] {
  const selectedNames = new Set(adapters.map(({ name }) => name));
  return supportedAgents
    .filter(({ value }) => !selectedNames.has(value))
    .map(({ value }) => createAdapter(value, { env: context.env, project: options.project }))
    .filter((adapter) => !adapter.project && existsSync(adapter.record));
}

function previewLifecycle(
  command: LifecycleCommand,
  adapters: Adapter[],
  options: CliOptions,
  context: ExecuteContext,
  interactive: boolean,
): number {
  const plans = adapters.map((adapter) =>
    describeLifecycle(command, adapter, options.force || false),
  );
  printLifecyclePlans(plans, context.io, Boolean(options.json || !interactive));
  if (interactive) finishInteractive('Preview complete. No files were changed.', context.output);
  return 0;
}

function executeLifecycle(
  command: Exclude<
    HarnessmithCommand,
    'setup' | 'adopt' | 'diagnostics' | 'export' | 'import' | 'install' | 'capabilities'
  >,
  adapters: Adapter[],
  options: CliOptions,
  context: ExecuteContext,
  interactive: boolean,
): number {
  if (command === 'status') {
    const inspections = options.explain ? inspectStatusAll(adapters) : [];
    const statuses = options.explain
      ? inspections.map(({ status }) => status)
      : statusAll(adapters);
    const explanations = inspections.map(explainStatus);
    if (options.explain && options.json) {
      explanations.forEach((explanation) => {
        context.io.log(JSON.stringify(explanation));
      });
    } else if (options.explain) {
      printStatusExplanations(explanations, context.io);
    } else if (options.json || !interactive) {
      statuses.forEach((status) => {
        context.io.log(JSON.stringify(status));
      });
    } else printStatuses(statuses, context.io);
    if (interactive) finishInteractive('Status check complete.', context.output);
    return statuses.every(
      (status) => status.installed && status.outputs.every((item) => item.status === 'managed'),
    )
      ? 0
      : 1;
  }
  if (options.dryRun) {
    return previewLifecycle(command, adapters, options, context, interactive);
  }
  const force = options.force === undefined ? {} : { force: options.force };
  const results =
    command === 'restore'
      ? restoreAll(adapters, force)
      : uninstallWithSkills(
          adapters,
          force,
          context.env,
          installedPeerAdapters(adapters, options, context),
        );
  for (const result of results) {
    if (options.json) context.io.log(JSON.stringify({ command, ...result }));
    else if (command === 'restore')
      context.io.log(`Restored ${result.adapter} to the previous installation state`);
    else context.io.log(`Uninstalled ${result.adapter} instruction files and installation record`);
  }
  if (interactive) {
    finishInteractive(
      command === 'restore' ? 'Previous installation restored.' : 'Harnessmith uninstalled.',
      context.output,
    );
  }
  return 0;
}

export function executeCapabilities(options: CliOptions, context: ExecuteContext): number {
  const agents = normalizeAgents(options.agent.length > 0 ? options.agent : ['all']);
  const report = {
    version: 1,
    adapters: agents.map((agent) => ({ agent, capabilities: adapterCapabilities(agent) })),
  };
  if (options.json) context.io.log(JSON.stringify(report));
  else {
    for (const { agent, capabilities } of report.adapters) {
      context.io.log(
        `${agent}: scope=${capabilities.scope}, activation=${capabilities.nativeRuleActivation}, ` +
          `instructions=${capabilities.enforcement.instructions}, permissions=${capabilities.enforcement.permissions}`,
      );
    }
  }
  return 0;
}

async function executeInstall(
  adapters: Adapter[],
  options: CliOptions,
  context: ExecuteContext,
  interactive: boolean,
): Promise<number> {
  const plans = adapters.map((adapter) => ({
    ...describeInstall(adapter),
    initializeGlobalMemory: options.initGlobal !== false,
  }));
  if (options.dryRun) {
    if (options.json || !interactive) {
      plans.forEach((plan) => {
        context.io.log(JSON.stringify(plan));
      });
    } else printPlans(plans, context.io);
    if (interactive) finishInteractive('Preview complete. No files were changed.', context.output);
    return 0;
  }
  let force = options.force;
  const hasConflicts = plans.some((plan) =>
    plan.outputs.some(({ action }) => action === 'conflict'),
  );
  if (!force && interactive && hasConflicts) {
    force = await confirmConflicts(plans, { input: context.input, output: context.output });
    if (!force) {
      throw new HarnessmithError(
        'SAFETY_CONFLICT',
        'Installation stopped; conflicting files were left unchanged',
        3,
      );
    }
  }
  const results = installWithSkills(adapters, {
    env: context.env,
    ...(force === undefined ? {} : { force }),
    noInitGlobal: !options.initGlobal,
  });
  if (options.json) context.io.log(JSON.stringify({ command: 'install', results }));
  else printInstallResults(results, context.io, { interactive, output: context.output });
  if (interactive) finishInteractive('Harness forged successfully.', context.output);
  return 0;
}

export async function executeAdapterCommand(
  command: AdapterCommand,
  options: CliOptions,
  context: ExecuteContext,
  interactive: boolean,
): Promise<number> {
  let adapters: Adapter[];
  try {
    adapters = await resolveAdapters(options, context);
  } catch (error) {
    if (
      command === 'status' &&
      options.explain &&
      error instanceof HarnessmithError &&
      error.code === 'CLI_USAGE' &&
      error.reason === 'unsupported-agent'
    ) {
      const explanation = explainUnsupportedStatus(options.agent);
      if (options.json) context.io.log(JSON.stringify(explanation));
      else printStatusExplanations([explanation], context.io);
      return 2;
    }
    throw error;
  }
  if (command === 'setup') return executeSetup(adapters, options, context, interactive);
  if (command === 'adopt') return executeAdopt(adapters, options, context, interactive);
  if (command === 'diagnostics') return executeDiagnostics(adapters, options, context);
  return command === 'install'
    ? executeInstall(adapters, options, context, interactive)
    : executeLifecycle(command, adapters, options, context, interactive);
}
