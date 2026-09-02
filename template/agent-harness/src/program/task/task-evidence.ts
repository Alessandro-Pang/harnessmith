import { type Command, Option } from 'commander';
import { verifyAcceptance } from '../../commands/task/task-verification.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';
import { collect, type TaskCliOptions } from './task-options.js';
import type { CommandRunner } from '../types.js';

export function registerTaskEvidenceCommand(
  task: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  task
    .command('verify')
    .description('mechanically verify an acceptance criterion')
    .option('--project <path>', 'project path', process.cwd())
    .requiredOption('--id <id>', 'task identifier')
    .requiredOption('--criterion <id>', 'acceptance criterion identifier')
    .requiredOption('--type <type>', 'command, test, file, or diff')
    .option('--command <executable>', 'executable for command or test evidence')
    .addOption(new Option('--arg <value>', 'executable argument').argParser(collect).default([]))
    .addOption(new Option('--scope <path>', 'freshness scope').argParser(collect).default([]))
    .option('--file <path>', 'file to digest for file evidence')
    .option('--timeout-ms <number>', 'command timeout in milliseconds', Number.parseInt)
    .option('--json', 'write machine-readable JSON')
    .action(
      run((options: TaskCliOptions) => {
        assertRuntimeCanMutate(runtime);
        return verifyAcceptance({ ...options, args: options.arg, type: options.type }, io);
      }),
    );
}
