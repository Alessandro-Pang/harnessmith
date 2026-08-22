import type { Command } from 'commander';
import { checkpointTask } from '../commands/task.js';
import { assertRuntimeCanMutate } from '../runtime.js';
import type { Io, Runtime, TaskStatus } from '../types.js';
import { type TaskCliOptions, taskOptions } from './task-options.js';
import type { CommandRunner } from './types.js';

export function registerTaskCheckpointCommand(
  task: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  taskOptions(task.command('checkpoint').description('append a checkpoint'), {
    summary: true,
  }).action(
    run((options: TaskCliOptions) => {
      assertRuntimeCanMutate(runtime);
      return checkpointTask(
        { ...options, nextAction: options.next, status: options.status as TaskStatus | undefined },
        io,
      );
    }),
  );
}
