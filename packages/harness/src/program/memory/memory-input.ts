import { type Command, Option } from 'commander';
import { captureInput, type InputOptions } from '../../commands/memory/memory-input.js';
import { type CloseInputOptions, closeInput } from '../../commands/memory/memory-input-close.js';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../../lib/filesystem/command-payload.js';
import type { Io, Runtime } from '../../types.js';
import { collect } from '../task/task-options.js';
import type { CommandRunner } from '../types.js';

const inputPayloadSchema = {
  fields: {
    title: 'string',
    content: 'string',
    contentFile: 'string',
    source: 'string',
    mode: 'string',
    purpose: 'string',
    retention: 'string',
    workstream: 'string',
    scope: 'string[]',
    sourceRefs: 'string[]',
  },
  required: ['title', 'source', 'mode', 'purpose', 'retention'],
  exactlyOne: [['content', 'contentFile']],
  aliases: { sourceRef: 'sourceRefs' },
} as const satisfies CommandPayloadSchema;

const closeInputPayloadSchema = {
  fields: { reason: 'string', evidenceRef: 'string' },
  required: ['reason'],
} as const satisfies CommandPayloadSchema;

export function registerMemoryInputCommands(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('capture-input <scope>')
    .description('capture a typed project input and index it')
    .option('--title <title>', 'input title')
    .option('--content <content>', 'verbatim input or reliable summary')
    .option('--content-file <path>', 'read verbatim input or a reliable summary from a file')
    .option('--source <source>', 'chat, file, meeting, link, or other')
    .option('--mode <mode>', 'verbatim or summary; must be explicit')
    .option(
      '--purpose <purpose>',
      'constraint, acceptance, source, risk-decision, or explicit-retain',
    )
    .option('--retention <retention>', 'workstream or durable')
    .option('--workstream <id>', 'stable workstream id required by workstream retention')
    .addOption(
      new Option('--scope <path>', 'repo-relative scope path; repeatable').argParser(collect),
    )
    .addOption(
      new Option('--source-ref <reference>', 'source reference; repeatable').argParser(collect),
    )
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((scope: string, options) => {
        const payload = resolveCommandPayload<InputOptions>(
          'memory capture-input',
          options,
          inputPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          captureInput(runtime, scope, resolved, io),
        );
      }),
    );

  memory
    .command('close-input <scope> <input>')
    .description('complete a typed project input and remove it from the active core index')
    .option('--reason <reason>', 'consumed, workstream-complete, promoted, or invalid')
    .option('--evidence-ref <reference>', 'reference that consumed or promoted the input')
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((scope: string, input: string, options) => {
        const payload = resolveCommandPayload<CloseInputOptions>(
          'memory close-input',
          options,
          closeInputPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          closeInput(runtime, scope, input, resolved, io),
        );
      }),
    );
}
