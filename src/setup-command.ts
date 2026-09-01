import type { Readable, Writable } from 'node:stream';
import { installAll } from './install.js';
import { createSetupGuide, setupVerificationPassed, verifySetup } from './setup.js';
import type { Adapter, CliOptions, InstallResult, Io } from './types.js';
import { HarnessmithError } from './types.js';
import {
  confirmSetup,
  finishInteractive,
  printInstallResults,
  printSetupGuide,
  printSetupVerification,
} from './ui.js';

interface SetupContext {
  env: NodeJS.ProcessEnv;
  io: Io;
  input: Readable;
  output: Writable;
}

export async function executeSetup(
  adapters: Adapter[],
  options: CliOptions,
  context: SetupContext,
  interactive: boolean,
): Promise<number> {
  const guide = createSetupGuide(adapters, options);
  if (options.dryRun) {
    if (options.json || !interactive) context.io.log(JSON.stringify(guide));
    else printSetupGuide(guide, context.io);
    if (interactive)
      finishInteractive('Setup preview complete. No files were changed.', context.output);
    return 0;
  }
  if (interactive) printSetupGuide(guide, context.io);
  const conflicts = guide.adapters.flatMap((plan) =>
    plan.outputs.filter(({ state }) => ['unmanaged', 'modified'].includes(state)),
  );
  if (conflicts.length > 0 && !options.force) {
    const states = [...new Set(conflicts.map(({ state }) => state))].join(', ');
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Setup refused ${states} targets by default; review setup --dry-run and use explicit --force only after verifying backups and ownership`,
      3,
    );
  }
  if (!interactive && !options.yes) {
    throw new HarnessmithError(
      'CLI_USAGE',
      'Non-interactive setup requires a prior dry-run and explicit --yes confirmation',
      2,
    );
  }
  if (interactive && !(await confirmSetup({ input: context.input, output: context.output }))) {
    finishInteractive('Setup cancelled. No files were changed.', context.output);
    return 0;
  }
  let results: InstallResult[];
  try {
    results = installAll(adapters, {
      env: context.env,
      force: options.force,
      noInitGlobal: !options.initGlobal,
    });
  } catch (error) {
    throw new HarnessmithError(
      error instanceof HarnessmithError ? error.code : 'INTERNAL_ERROR',
      `Setup failed; the installation transaction attempted rollback. Next run setup --dry-run, inspect status, and use restore only if a prior layer exists: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof HarnessmithError ? error.exitCode : 1,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  const verification = verifySetup(adapters, options, context.env);
  const passed = setupVerificationPassed(verification);
  const report = {
    ...guide,
    phase: 'complete' as const,
    result: passed ? ('installed-and-healthy' as const) : ('verification-failed' as const),
    installation: results,
    verification,
  };
  if (options.json) context.io.log(JSON.stringify(report));
  else {
    printInstallResults(results, context.io, { interactive, output: context.output });
    printSetupVerification(verification, context.io);
    context.io.log(`First task: ${guide.minimalExample.prompt}`);
  }
  if (interactive) {
    finishInteractive(
      passed
        ? 'Setup complete. Deterministic health passed; real Host behavior is not yet verified.'
        : `Setup installed, but verification failed. Inspect with ${guide.recovery.inspect}.`,
      context.output,
    );
  }
  return passed ? 0 : 1;
}
