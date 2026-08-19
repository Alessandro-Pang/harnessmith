import { type Command, Option } from 'commander';
import {
  checkpointTask,
  closeTask,
  initTask,
  taskStatus,
  updateAcceptance,
} from '../commands/task.js';
import type { AcceptanceStatus, Io, Runtime, TaskStatus } from '../types.js';
import type { CommandRunner } from './types.js';

interface TaskCliOptions {
  id?: string;
  objective?: string;
  accept?: string[];
  next?: string;
  status?: TaskStatus | AcceptanceStatus;
  evidence?: string[];
  summary?: string;
  criterion?: string;
  json?: boolean;
  project?: string;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function taskOptions(command: Command, { summary = false, acceptance = false } = {}): Command {
  command
    .option('--project <path>', 'project path', process.cwd())
    .option('--id <id>', 'task identifier')
    .option('--next <text>', 'next action')
    .option('--status <status>', 'task or acceptance status')
    .addOption(
      new Option('--evidence <reference>', 'evidence reference')
        .argParser(collect)
        .default([] as string[]),
    )
    .option('--json', 'write machine-readable JSON');
  if (summary) command.requiredOption('--summary <text>', 'checkpoint summary');
  if (acceptance) command.requiredOption('--criterion <id>', 'acceptance criterion identifier');
  return command;
}

export function registerTaskCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  const task = program.command('task').description('manage long-running task ledgers');
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
      run((options: TaskCliOptions) =>
        initTask(runtime, { ...options, nextAction: options.next, acceptance: options.accept }, io),
      ),
    );
  task
    .command('status')
    .description('show one task or all tasks')
    .option('--project <path>', 'project path', process.cwd())
    .option('--id <id>', 'task identifier')
    .option('--json', 'write machine-readable JSON')
    .action(run((options: TaskCliOptions) => taskStatus(options, io)));
  taskOptions(task.command('checkpoint').description('append a checkpoint'), {
    summary: true,
  }).action(
    run((options: TaskCliOptions) =>
      checkpointTask(
        { ...options, nextAction: options.next, status: options.status as TaskStatus | undefined },
        io,
      ),
    ),
  );
  taskOptions(task.command('accept').description('update an acceptance criterion'), {
    acceptance: true,
  }).action(
    run((options: TaskCliOptions) =>
      updateAcceptance({ ...options, status: options.status as AcceptanceStatus | undefined }, io),
    ),
  );
  taskOptions(task.command('close').description('close or block a task'), { summary: true }).action(
    run((options: TaskCliOptions) =>
      closeTask(
        { ...options, nextAction: options.next, status: options.status as TaskStatus | undefined },
        io,
      ),
    ),
  );
}
