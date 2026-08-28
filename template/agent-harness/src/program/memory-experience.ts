import { type Command, Option } from 'commander';
import { captureExperience, type ExperienceOptions } from '../commands/memory-experience.js';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../lib/command-payload.js';
import type { Io, Runtime } from '../types.js';
import { collect } from './task-options.js';
import type { CommandRunner } from './types.js';

const experiencePayloadSchema = {
  fields: {
    kind: 'string',
    title: 'string',
    conclusion: 'string',
    evidence: 'string[]',
    sourceRefs: 'string[]',
  },
  required: ['kind', 'title', 'conclusion', 'evidence', 'sourceRefs'],
  aliases: { sourceRef: 'sourceRefs' },
} as const satisfies CommandPayloadSchema;

export function registerMemoryExperienceCommand(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('capture-experience <scope>')
    .description('capture or reconcile one sourced lesson or failure experience')
    .option('--kind <kind>', 'lesson or failure')
    .option('--title <title>', 'bounded experience title')
    .option('--conclusion <text>', 'stable reusable conclusion')
    .addOption(
      new Option('--evidence <text>', 'supporting evidence; repeatable').argParser(collect),
    )
    .addOption(
      new Option('--source-ref <reference>', 'source reference; repeatable').argParser(collect),
    )
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((scope: string, options) => {
        const payload = resolveCommandPayload<ExperienceOptions>(
          'memory capture-experience',
          options,
          experiencePayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          captureExperience(runtime, scope, resolved, io),
        );
      }),
    );
}
