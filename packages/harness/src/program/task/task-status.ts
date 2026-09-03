import type { Command } from 'commander';
import { taskStatus } from '../../commands/task/task.js';
import type { Io } from '../../types.js';
import type { CommandRunner } from '../types.js';
import type { TaskCliOptions } from './task-options.js';

export function registerTaskStatusCommand(task: Command, io: Io, run: CommandRunner): void {
  task
    .command('status')
    .description('show one task or all tasks')
    .option('--project <path>', 'project path', process.cwd())
    .option('--id <id>', 'task identifier')
    .option('--json', 'write machine-readable JSON')
    .action(run((options: TaskCliOptions) => taskStatus(options, io)));
}
