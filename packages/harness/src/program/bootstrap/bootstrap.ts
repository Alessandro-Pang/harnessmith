import { type Command, Option } from 'commander';
import { type BootstrapOptions, bootstrapProject } from '../../commands/bootstrap/bootstrap.js';
import { documentationIntents } from '../../lib/documentation/docs-routing.js';
import type { Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';

interface BootstrapCommandOptions extends BootstrapOptions {
  project?: string;
}

/**
 * The single startup command the always-on entry runs per task: project and Memory discovery
 * plus documentation routing of the verbatim request, so the agent needs no routing decision.
 */
export function registerBootstrapCommand(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  program
    .command('bootstrap [query...]')
    .description(
      'read one bounded project and Memory startup summary; with the raw request, also route documentation',
    )
    .requiredOption('--project <path>', 'project path')
    .addOption(
      new Option('--detail <level>', 'startup detail level')
        .choices(['brief', 'full'])
        .default('brief'),
    )
    .addOption(
      new Option('--intent <intent>', 'validated primary documentation intent').choices([
        ...documentationIntents,
      ]),
    )
    .option('--json', 'write a machine-readable startup summary')
    .action(
      run((query: string[], options: BootstrapCommandOptions) =>
        bootstrapProject(runtime, options.project as string, { ...options, query }, io),
      ),
    );
}
