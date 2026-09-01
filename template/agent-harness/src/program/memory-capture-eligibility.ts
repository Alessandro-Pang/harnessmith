import type { Command } from 'commander';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../lib/command-payload.js';
import {
  type CaptureEligibilityInput,
  evaluateCaptureEligibility,
} from '../lib/memory-capture-eligibility.js';
import type { Io } from '../types.js';
import type { CommandRunner } from './types.js';

const captureEligibilityPayloadSchema = {
  fields: {
    evaluation: 'string',
    candidateKind: 'string',
    retention: 'string',
    taskReadOnly: 'boolean',
    highValue: 'boolean',
    rootInitialized: 'boolean',
    typedWriter: 'string',
    authorized: 'boolean',
    source: 'string',
    containsSecret: 'boolean',
    sensitiveData: 'string',
    cheaplyRecoverable: 'boolean',
    oneShotAuthorization: 'boolean',
    authoritativeDuplicate: 'boolean',
    existingMatch: 'string',
  },
  required: [
    'evaluation',
    'candidateKind',
    'retention',
    'taskReadOnly',
    'highValue',
    'rootInitialized',
    'typedWriter',
    'authorized',
    'source',
    'containsSecret',
    'sensitiveData',
    'cheaplyRecoverable',
    'oneShotAuthorization',
    'authoritativeDuplicate',
    'existingMatch',
  ],
} as const satisfies CommandPayloadSchema;

export function registerMemoryCaptureEligibilityCommand(
  memory: Command,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('evaluate-capture')
    .description('evaluate one Memory capture candidate without writing it')
    .requiredOption('--payload-file <path>', 'read the complete candidate from bounded JSON')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable eligibility result')
    .action(
      run((options) => {
        const payload = resolveCommandPayload<CaptureEligibilityInput>(
          'memory evaluate-capture',
          options,
          captureEligibilityPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) => {
          const result = evaluateCaptureEligibility(resolved);
          io.log(options.json ? JSON.stringify(result) : `${result.status}: ${result.reasonCode}`);
          return result;
        });
      }),
    );
}
