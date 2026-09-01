import type { Command } from 'commander';
import { memoryCheck, memoryList, memorySearch } from '../commands/memory.js';
import { type CurationOptions, curateMemory } from '../commands/memory-curation.js';
import { archiveMemory, memoryMaintenance, supersedeMemory } from '../commands/memory-lifecycle.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import {
  type MemoryPromotionOptions,
  memoryPromotionProposal,
} from '../commands/memory-promotion.js';
import type { Io, Runtime } from '../types.js';
import { registerMemoryAutopilotCommands } from './memory-autopilot.js';
import { registerMemoryCaptureEligibilityCommand } from './memory-capture-eligibility.js';
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
    .command('curate <scope>')
    .description('report proposal-first curation candidates for one task or workstream')
    .requiredOption('--task <id>', 'task id that scopes the report')
    .option('--workstream <id>', 'stable workstream id; defaults to the task id')
    .option(
      '--outcome <outcome>',
      'phase-complete, task-complete, workstream-complete, or user-cancel',
    )
    .option('--json', 'write a machine-readable curation report')
    .action(
      run((scope: string, options: CurationOptions) => curateMemory(runtime, scope, options, io)),
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
  registerMemoryCaptureEligibilityCommand(memory, io, run);
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
    .requiredOption('--artifact-type <type>', 'adr, docs, tests, schema, lint, or ci')
    .requiredOption('--owner <owner>', 'owner of the authoritative target')
    .requiredOption('--reason <reason>', 'bounded reason for promotion')
    .requiredOption('--verifier <command>', 'exact verifier required after adoption')
    .option(
      '--adoption-evidence <reference...>',
      'evidence that the target already carries the fact',
    )
    .option('--json', 'write the proposal as JSON')
    .action(
      run((scope: string, name: string, options: MemoryPromotionOptions) =>
        memoryPromotionProposal(runtime, scope, name, options, io),
      ),
    );
}
