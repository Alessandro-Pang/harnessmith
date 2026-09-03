import type { Readable, Writable } from 'node:stream';
import { confirmAdopt, finishInteractive, printAdoptPlan } from '../presentation/ui.js';
import type { Adapter, CliOptions, Io } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { applyAdoptPlan, createAdoptPlan } from './adopt.js';

interface AdoptContext {
  env: NodeJS.ProcessEnv;
  io: Io;
  input: Readable;
  output: Writable;
}

export async function executeAdopt(
  adapters: Adapter[],
  options: CliOptions,
  context: AdoptContext,
  interactive: boolean,
): Promise<number> {
  const plan = createAdoptPlan(adapters, context.env);
  if (!interactive && options.yes && !options.proposal && plan.report.requiresWrite) {
    throw new HarnessmithError(
      'CLI_USAGE',
      'Non-interactive adopt requires --proposal <id> from the exact preview and --yes',
      2,
    );
  }
  const applyingNonInteractively = Boolean(
    !interactive && !options.dryRun && options.yes && options.proposal,
  );
  if (!applyingNonInteractively || plan.report.blocked.length > 0) {
    if (options.json || !interactive) context.io.log(JSON.stringify(plan.report));
    else printAdoptPlan(plan.report, context.io);
  }
  if (plan.report.blocked.length > 0) return 3;
  if (!plan.report.requiresWrite || options.dryRun) return 0;

  let proposal = options.proposal;
  if (interactive) {
    if (!(await confirmAdopt(plan.report, { input: context.input, output: context.output }))) {
      finishInteractive('Adopt cancelled. No files were changed.', context.output);
      return 0;
    }
    proposal = plan.report.proposalId;
  } else if (!options.yes) {
    return 0;
  }

  const result = applyAdoptPlan(adapters, context.env, {
    proposal,
    initGlobal: options.initGlobal,
  });
  if (options.json) context.io.log(JSON.stringify(result));
  else context.io.log(`Adopted existing rules into ${result.target.path}`);
  if (interactive)
    finishInteractive('Adopt complete. Original Host files were backed up.', context.output);
  return 0;
}
