import { type Command, Option } from 'commander';
import { initTask } from '../../commands/task/task.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';
import { collect, type TaskCliOptions } from './task-options.js';

export function registerTaskInitCommand(
  task: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  task
    .command('init')
    .description('create a task ledger')
    .option('--project <path>', 'project path', process.cwd())
    .option('--id <id>', 'task identifier')
    .requiredOption('--objective <text>', 'task objective')
    .addOption(
      new Option('--accept <criterion>', 'acceptance criterion')
        .argParser(collect)
        .default([] as string[]),
    )
    .option('--next <text>', 'next action', '')
    .option('--json', 'write machine-readable JSON')
    .action(
      run((options: TaskCliOptions) => {
        assertRuntimeCanMutate(runtime);
        return initTask(
          runtime,
          { ...options, nextAction: options.next, acceptance: options.accept },
          io,
        );
      }),
    );
}
