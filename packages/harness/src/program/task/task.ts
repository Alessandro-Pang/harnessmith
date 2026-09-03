import type { Command } from 'commander';
import type { Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';
import { registerTaskAcceptanceCommand } from './task-accept.js';
import { registerTaskCheckpointCommand } from './task-checkpoint.js';
import { registerTaskCloseCommand } from './task-close.js';
import { registerTaskEvidenceCommand } from './task-evidence.js';
import { registerTaskInitCommand } from './task-init.js';
import { registerTaskStatusCommand } from './task-status.js';

export function registerTaskCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  const task = program.command('task').description('manage long-running task ledgers');
  registerTaskInitCommand(task, runtime, io, run);
  registerTaskStatusCommand(task, io, run);
  registerTaskCheckpointCommand(task, runtime, io, run);
  registerTaskAcceptanceCommand(task, runtime, io, run);
  registerTaskEvidenceCommand(task, runtime, io, run);
  registerTaskCloseCommand(task, runtime, io, run);
}
