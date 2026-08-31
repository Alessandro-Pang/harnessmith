import type { Command } from 'commander';
import { memoryCheck, memoryList, memorySearch } from '../commands/memory.js';
import { archiveMemory, memoryMaintenance, supersedeMemory } from '../commands/memory-lifecycle.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import { memoryPromotionProposal } from '../commands/memory-promotion.js';
import type { Io, Runtime } from '../types.js';
import { registerMemoryAutopilotCommands } from './memory-autopilot.js';
import { addSearchOptions, type SearchCommandOptions } from './search-options.js';
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
    .option('--json', 'write the document index as JSON')
    .action(
      run((scope: string = '.', options: { json?: boolean }) =>
        memoryList(runtime, scope, io, options),
      ),
    );
  addSearchOptions(
    memory
      .command('search <scope> <query...>')
      .description('search memory text with safe index fallback'),
  ).action(
    run((scope: string, query: string[], options: SearchCommandOptions) =>
      memorySearch(runtime, scope, query.join(' '), io, options),
    ),
  );
  memory
    .command('check [scope]')
    .description('validate memory references and metadata')
    .option('--indexed', 'require active memory to be reachable from an index')
    .option('--json', 'write the validation result as JSON')
    .action(
      run((scope: string = '.', options: { indexed?: boolean; json?: boolean }) =>
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
  registerMemoryMutationCommands(memory, runtime, io, run);
  registerMemoryAutopilotCommands(memory, runtime, io, run);
}

function registerMemoryMutationCommands(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('migrate <scope> <memory>')
    .description('propose or apply an explicit legacy metadata migration')
    .option('--set <json>', 'metadata updates as a JSON object', '{}')
    .option('--apply', 'apply a ready migration under the shared memory lock')
    .option('--json', 'write the migration report as JSON')
    .action(
      run(
        (scope: string, name: string, options: { set: string; apply?: boolean; json?: boolean }) =>
          memoryMigrate(runtime, scope, name, options.set, options, io),
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
