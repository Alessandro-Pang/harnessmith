import type { Command } from 'commander';
import { updateAcceptance } from '../../commands/task/task-acceptance.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { AcceptanceStatus, Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';
import { type TaskCliOptions, taskOptions } from './task-options.js';

export function registerTaskAcceptanceCommand(
  task: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  taskOptions(task.command('accept').description('update an acceptance criterion'), {
    acceptance: true,
  }).action(
    run((options: TaskCliOptions) => {
      assertRuntimeCanMutate(runtime);
      const { status, ...taskOptions } = options;
      return updateAcceptance(
        {
          ...taskOptions,
          ...(status === undefined ? {} : { status: status as AcceptanceStatus }),
        },
        io,
      );
    }),
  );
}
