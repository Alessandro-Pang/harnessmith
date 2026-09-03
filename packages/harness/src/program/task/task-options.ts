import { type Command, Option } from 'commander';
import type { AcceptanceStatus, TaskStatus } from '../../types.js';

export interface TaskCliOptions {
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
  type?: 'command' | 'test' | 'file' | 'diff';
  command?: string;
  arg?: string[];
  scope?: string[];
  file?: string;
  timeoutMs?: number;
}

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function taskOptions(
  command: Command,
  { summary = false, acceptance = false } = {},
): Command {
  command
    .option('--project <path>', 'project path', process.cwd())
    .option('--id <id>', 'task identifier')
    .option('--next <text>', 'next action')
    .option('--status <status>', 'task or acceptance status')
    .addOption(
      new Option('--evidence <json>', 'typed evidence JSON')
        .argParser(collect)
        .default([] as string[]),
    )
    .option('--json', 'write machine-readable JSON');
  if (summary) command.requiredOption('--summary <text>', 'checkpoint summary');
  if (acceptance) command.requiredOption('--criterion <id>', 'acceptance criterion identifier');
  return command;
}
