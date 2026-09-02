import type { Command } from 'commander';
import { memoryCheck, memoryList, memorySearch } from '../commands/memory.js';
import { archiveMemory, supersedeMemory } from '../commands/memory-lifecycle.js';
import { memoryMaintenance } from '../commands/memory-maintenance.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import {
  type MemoryPromotionOptions,
  memoryPromotionProposal,
} from '../commands/memory-promotion.js';
import { memoryRepair } from '../commands/memory-repair.js';
import { workflowRelations } from '../commands/workflow-relations.js';
import type { CurationCommandOptions } from '../lib/memory-curation-types.js';
import type { Io, Runtime } from '../types.js';
import { registerMemoryAutopilotCommands } from './memory-autopilot.js';
import { registerMemoryCandidateDiscoveryCommand } from './memory-candidate-discovery.js';
import { registerMemoryCaptureEligibilityCommand } from './memory-capture-eligibility.js';
import { memoryCuration } from './memory-curation-apply.js';
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
    .option('--apply <proposal...>', 'apply one or more exact proposal ids')
    .option('--apply-file <path>', 'read bounded typed proposal selections from JSON')
    .option('--yes', 'confirm the selected typed curation actions')
    .option('--json', 'write a machine-readable curation report')
    .action(
      run((scope: string, options: CurationCommandOptions) =>
        memoryCuration(runtime, scope, options, io),
      ),
    );
  memory
    .command('relationships <scope>')
    .description('report Task, workstream, session, and Memory relationships')
    .option('--json', 'write a machine-readable relationship report')
    .action(
      run((scope: string, options: { json?: boolean }) =>
        workflowRelations(runtime, scope, options, io),
      ),
    );
  memory
    .command('maintain [scope]')
    .description('report typed Memory maintenance candidates and audit coverage')
    .option('--json', 'write the report as JSON')
    .action(
      run((scope: string = '.', options: { json?: boolean }) =>
        memoryMaintenance(runtime, scope, options, io),
      ),
    );
  memory
    .command('repair [scope]')
    .description('diagnose bounded repairs or apply one exact proposal')
    .option('--proposal <id>', 'apply the exact proposal from a prior diagnosis')
    .option('--yes', 'confirm the selected repair proposal')
    .option('--json', 'write the repair plan or result as JSON')
    .action(
      run((scope: string = '.', options: { proposal?: string; yes?: boolean; json?: boolean }) =>
        memoryRepair(runtime, scope, options, io),
      ),
    );
  registerMemoryCaptureEligibilityCommand(memory, io, run);
  registerMemoryCandidateDiscoveryCommand(memory, io, run);
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
