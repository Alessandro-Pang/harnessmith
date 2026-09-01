import { type Command, Option } from 'commander';
import { captureFinding, type FindingOptions } from '../commands/memory-finding.js';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../lib/command-payload.js';
import type { Io, Runtime } from '../types.js';
import { collect } from './task-options.js';
import type { CommandRunner } from './types.js';

const findingPayloadSchema = {
  fields: {
    kind: 'string',
    retention: 'string',
    factClass: 'string',
    title: 'string',
    conclusion: 'string',
    rationale: 'string',
    application: 'string',
    evidence: 'string[]',
    sourceRefs: 'string[]',
    workstream: 'string',
    expires: 'string',
  },
  required: [
    'kind',
    'retention',
    'factClass',
    'title',
    'conclusion',
    'rationale',
    'application',
    'evidence',
    'sourceRefs',
  ],
  aliases: { sourceRef: 'sourceRefs' },
} as const satisfies CommandPayloadSchema;

export function registerMemoryFindingCommand(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('capture-finding <scope>')
    .description('capture or reconcile one sourced analysis, review, or research finding')
    .option('--kind <kind>', 'analysis, review, or research')
    .option('--retention <retention>', 'workstream or durable')
    .option(
      '--fact-class <class>',
      'settled-fact, current-state, verification-pointer, recovery-state, or formal-fact',
    )
    .option('--title <title>', 'bounded finding title')
    .option('--conclusion <text>', 'stable finding conclusion')
    .option('--rationale <text>', 'why the conclusion follows')
    .option('--application <text>', 'how the finding should be applied')
    .addOption(
      new Option('--evidence <text>', 'supporting evidence; repeatable').argParser(collect),
    )
    .addOption(
      new Option('--source-ref <reference>', 'source reference; repeatable').argParser(collect),
    )
    .option('--workstream <id>', 'stable id required by workstream retention')
    .option('--expires <date>', 'calendar expiry required by workstream retention')
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((scope: string, options) => {
        const payload = resolveCommandPayload<FindingOptions>(
          'memory capture-finding',
          options,
          findingPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          captureFinding(runtime, scope, resolved, io),
        );
      }),
    );
}
