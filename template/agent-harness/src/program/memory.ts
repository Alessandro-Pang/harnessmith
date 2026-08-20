import type { Command } from 'commander';
import {
  archiveMemory,
  memoryCheck,
  memoryList,
  memoryMaintenance,
  memoryPromotionProposal,
  memorySearch,
  supersedeMemory,
} from '../commands/memory.js';
import type { Io, Runtime } from '../types.js';
import type { CommandRunner } from './types.js';

export function registerMemoryCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  const memory = program.command('memory').description('inspect Markdown memory');
  memory
    .command('list [scope]')
    .description('list memory documents')
    .action(run((scope: string = '.') => memoryList(runtime, scope, io)));
  memory
    .command('search <scope> <query...>')
    .description('search memory text')
    .action(
      run((scope: string, query: string[]) => memorySearch(runtime, scope, query.join(' '), io)),
    );
  memory
    .command('check [scope]')
    .description('validate memory references and metadata')
    .option('--indexed', 'require active memory to be reachable from an index')
    .action(
      run((scope: string = '.', options: { indexed?: boolean }) =>
        memoryCheck(runtime, scope, io, options),
      ),
    );
  memory
    .command('maintain [scope]')
    .description('report unindexed, expired, and closed memory candidates')
    .option('--json', 'write the report as JSON')
    .action(
      run((scope: string = '.', options: { json?: boolean }) =>
        memoryMaintenance(runtime, scope, options, io),
      ),
    );
  memory
    .command('supersede <scope> <memory>')
    .description('mark a memory as superseded by another memory')
    .requiredOption('--by <memory>', 'replacement memory path')
    .action(
      run((scope: string, name: string, options: { by: string }) =>
        supersedeMemory(runtime, scope, name, options.by, io),
      ),
    );
  memory
    .command('archive <scope> <memory>')
    .description('move a closed memory into the dated archive')
    .option('--force', 'archive an active or blocked memory')
    .action(
      run((scope: string, name: string, options: { force?: boolean }) =>
        archiveMemory(runtime, scope, name, options, io),
      ),
    );
  memory
    .command('promote <scope> <memory>')
    .description('emit a proposal for promoting memory into an authoritative project document')
    .requiredOption('--target <path>', 'project-relative authoritative document path')
    .option('--json', 'write the proposal as JSON')
    .action(
      run((scope: string, name: string, options: { target: string }) =>
        memoryPromotionProposal(runtime, scope, name, options.target, io),
      ),
    );
}
