import type { Command } from 'commander';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../lib/command-payload.js';
import {
  type CandidateDiscoveryEvent,
  discoverMemoryCandidates,
} from '../lib/memory-candidate-discovery.js';
import type { Io } from '../types.js';
import type { CommandRunner } from './types.js';

const candidateDiscoveryPayloadSchema = {
  fields: {
    source: 'string',
    text: 'string',
    taskId: 'string',
  },
  required: ['source', 'text'],
} as const satisfies CommandPayloadSchema;

export function registerMemoryCandidateDiscoveryCommand(
  memory: Command,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('discover-candidates')
    .description('discover typed Memory candidates without writing them')
    .requiredOption('--payload-file <path>', 'read one bounded conversation or tool event')
    .option('--consume-payload-file', 'delete the unchanged payload after processing')
    .option('--json', 'write machine-readable candidates')
    .action(
      run((options) => {
        const payload = resolveCommandPayload<CandidateDiscoveryEvent>(
          'memory discover-candidates',
          options,
          candidateDiscoveryPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) => {
          const candidates = discoverMemoryCandidates(resolved);
          const result = { version: 1, candidates };
          io.log(options.json ? JSON.stringify(result) : `candidates: ${candidates.length}`);
          return result;
        });
      }),
    );
}
