import type { Command } from 'commander';
import { closeTask } from '../../commands/task/task.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime, TaskStatus } from '../../types.js';
import { type TaskCliOptions, taskOptions } from './task-options.js';
import type { CommandRunner } from '../types.js';

export function registerTaskCloseCommand(
  task: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  taskOptions(task.command('close').description('close or block a task'), { summary: true }).action(
    run((options: TaskCliOptions) => {
      assertRuntimeCanMutate(runtime);
      return closeTask(
        { ...options, nextAction: options.next, status: options.status as TaskStatus | undefined },
        io,
      );
    }),
  );
}
