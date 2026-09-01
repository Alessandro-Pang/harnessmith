import type { Readable, Writable } from 'node:stream';
import { adapterCapabilities, createAdapter } from './adapters.js';
import { executeAdopt } from './adopt-command.js';
import { normalizeAgents } from './agents.js';
import { installAll } from './install.js';
import { inspectStatusAll, restoreAll, statusAll, uninstallAll } from './lifecycle.js';
import { describeLifecycle } from './lifecycle-plan.js';
import type { HarnessmithCommand } from './program.js';
import { assertNonOverlappingAdapters, describeInstall } from './records.js';
import { executeSetup } from './setup-command.js';
import { explainStatus, explainUnsupportedStatus } from './status-explanation.js';
import type { Adapter, CliOptions, Io, LifecycleCommand, LifecyclePlan } from './types.js';
import { HarnessmithError } from './types.js';
import {
  confirmConflicts,
  finishInteractive,
  printInstallResults,
  printPlans,
  printStatusExplanations,
  printStatuses,
  selectAgents,
  startInteractive,
} from './ui.js';

interface ExecuteContext {
  env: NodeJS.ProcessEnv;
  io: Io;
  input: Readable;
  output: Writable;
}

function isTty(stream: Readable | Writable): boolean {
  return 'isTTY' in stream && stream.isTTY === true;
}

async function resolveAdapters(options: CliOptions, context: ExecuteContext): Promise<Adapter[]> {
  let requested = options.agent;
  if (requested.length === 0 && options.yes) requested = ['codex'];
  if (requested.length === 0 && isTty(context.input) && isTty(context.output) && !options.json) {
    requested = await selectAgents({ input: context.input, output: context.output });
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

function printLifecyclePlans(
  plans: LifecyclePlan[],
  context: ExecuteContext,
  machineReadable: boolean,
): void {
  if (machineReadable) {
    for (const plan of plans) context.io.log(JSON.stringify(plan));
    return;
  }
  for (const plan of plans) {
    context.io.log(`${plan.command} ${plan.adapter}  ${plan.home}`);
    for (const [index, layer] of plan.layers.entries()) {
      context.io.log(`  layer ${index + 1}  ${layer.sourceRecord}`);
      for (const change of layer.changes) {
        context.io.log(
          `    ${change.action.padEnd(20)} ${change.path}${change.source ? ` <- ${change.source}` : ''}`,
        );
      }
    }
  }
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
  printLifecyclePlans(plans, context, Boolean(options.json || !interactive));
  if (interactive) finishInteractive('Preview complete. No files were changed.', context.output);
  return 0;
}

function executeLifecycle(
  command: Exclude<HarnessmithCommand, 'setup' | 'adopt' | 'install' | 'capabilities'>,
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
  const results =
    command === 'restore'
      ? restoreAll(adapters, { force: options.force })
      : uninstallAll(adapters, { force: options.force });
  for (const result of results) {
    if (options.json) context.io.log(JSON.stringify({ command, ...result }));
    else if (command === 'restore')
      context.io.log(`Restored ${result.adapter} to the previous installation state`);
    else
      context.io.log(
        `Uninstalled ${result.adapter}: restored ${'layers' in result ? result.layers : 0} installation layer(s)`,
      );
  }
  if (interactive) {
    finishInteractive(
      command === 'restore' ? 'Previous installation restored.' : 'Harnessmith uninstalled.',
      context.output,
    );
  }
  return 0;
}

function executeCapabilities(options: CliOptions, context: ExecuteContext): number {
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
  const results = installAll(adapters, {
    env: context.env,
    force,
    noInitGlobal: !options.initGlobal,
  });
  if (options.json) context.io.log(JSON.stringify({ command: 'install', results }));
  else printInstallResults(results, context.io, { interactive, output: context.output });
  if (interactive) finishInteractive('Harness forged successfully.', context.output);
  return 0;
}

export async function executeCommand(
  command: HarnessmithCommand,
  options: CliOptions,
  context: ExecuteContext,
): Promise<number> {
  const interactive =
    !options.yes && isTty(context.input) && isTty(context.output) && !options.json;
  if (interactive) startInteractive(context.output);
  if (command === 'capabilities') return executeCapabilities(options, context);
  let adapters: Adapter[];
  try {
    adapters = await resolveAdapters(options, context);
  } catch (error) {
    if (
      command === 'status' &&
      options.explain &&
      error instanceof HarnessmithError &&
      error.code === 'CLI_USAGE' &&
      error.message.startsWith('Unsupported agent:')
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
  return command === 'install'
    ? executeInstall(adapters, options, context, interactive)
    : executeLifecycle(command, adapters, options, context, interactive);
}
