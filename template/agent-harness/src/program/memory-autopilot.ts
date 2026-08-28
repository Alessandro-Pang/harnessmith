import { type Command, Option } from 'commander';
import { captureHandoff, closeHandoff, type HandoffOptions } from '../commands/memory-autopilot.js';
import { captureInput, type InputOptions } from '../commands/memory-input.js';
import {
  type ProfileOptions,
  type RemoveProfileOptions,
  reconcileProfile,
  removeProfileEntry,
  setProfileAutopilot,
} from '../commands/memory-profile.js';
import {
  type CommandPayloadSchema,
  executeCommandPayload,
  resolveCommandPayload,
} from '../lib/command-payload.js';
import type { Io, Runtime } from '../types.js';
import { registerMemoryExperienceCommand } from './memory-experience.js';
import { collect } from './task-options.js';
import type { CommandRunner } from './types.js';

const inputPayloadSchema = {
  fields: {
    title: 'string',
    content: 'string',
    contentFile: 'string',
    source: 'string',
    summary: 'boolean',
  },
  required: ['title', 'source'],
  exactlyOne: [['content', 'contentFile']],
} as const satisfies CommandPayloadSchema;

const handoffPayloadSchema = {
  fields: {
    session: 'string',
    taskId: 'string',
    title: 'string',
    objective: 'string',
    completed: 'string',
    facts: 'string',
    decisions: 'string',
    verification: 'string',
    open: 'string',
    next: 'string',
    reason: 'string',
    status: 'string',
    scope: 'string[]',
    sourceRefs: 'string[]',
    clearFacts: 'boolean',
    clearDecisions: 'boolean',
    clearVerification: 'boolean',
    clearOpen: 'boolean',
    clearScope: 'boolean',
    clearSourceRefs: 'boolean',
  },
  required: ['session', 'title', 'objective', 'completed', 'next', 'reason'],
  aliases: { sourceRef: 'sourceRefs' },
} as const satisfies CommandPayloadSchema;

const reconcileProfilePayloadSchema = {
  fields: {
    key: 'string',
    conclusion: 'string',
    evidence: 'string',
    confidence: 'string',
    userDirected: 'boolean',
  },
  required: ['key', 'conclusion', 'evidence', 'confidence'],
} as const satisfies CommandPayloadSchema;

const forgetProfilePayloadSchema = {
  fields: { key: 'string' },
  required: ['key'],
} as const satisfies CommandPayloadSchema;

function registerProjectAutopilotCommands(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  registerMemoryExperienceCommand(memory, runtime, io, run);
  memory
    .command('capture-input <scope>')
    .description('capture a typed project input and index it')
    .option('--title <title>', 'input title')
    .option('--content <content>', 'verbatim input or reliable summary')
    .option('--content-file <path>', 'read verbatim input or a reliable summary from a file')
    .option('--source <source>', 'chat, file, meeting, link, or other')
    .option('--summary', 'mark content as a reliable summary rather than verbatim')
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
    .command('handoff <scope>')
    .description('create or replace an indexed project recovery snapshot')
    .option('--session <id>', 'stable workstream identifier')
    .option('--task-id <id>', 'task ledger that owns the current next action')
    .option('--title <title>', 'handoff title')
    .option('--objective <objective>', 'current objective')
    .option('--completed <summary>', 'completed work summary')
    .option('--facts <summary>', 'confirmed recovery facts')
    .option('--decisions <summary>', 'current decisions worth carrying forward')
    .option('--verification <summary>', 'current verification evidence')
    .option('--open <summary>', 'current unresolved issues or risks')
    .option('--next <action>', 'single next action')
    .option('--reason <reason>', 'phase, compaction, multi-task, or manual')
    .option('--status <status>', 'active or blocked; omitted updates preserve current status')
    .addOption(new Option('--scope <path>', 'recovery scope; repeatable').argParser(collect))
    .addOption(
      new Option('--source-ref <reference>', 'source reference; repeatable').argParser(collect),
    )
    .option('--clear-facts', 'remove previously captured facts')
    .option('--clear-decisions', 'remove previously captured decisions')
    .option('--clear-verification', 'remove previously captured verification')
    .option('--clear-open', 'remove previously captured unresolved issues')
    .option('--clear-scope', 'remove previously captured recovery scope')
    .option('--clear-source-refs', 'remove previously captured source references')
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((scope: string, options) => {
        const payload = resolveCommandPayload<HandoffOptions>(
          'memory handoff',
          options,
          handoffPayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          captureHandoff(runtime, scope, resolved, io),
        );
      }),
    );

  memory
    .command('close-handoff <scope>')
    .description('close a project recovery snapshot and remove its active index entry')
    .requiredOption('--session <id>', 'stable workstream identifier')
    .requiredOption('--outcome <outcome>', 'completed or cancelled')
    .option('--json', 'write a machine-readable result')
    .action(run((scope: string, options) => closeHandoff(runtime, scope, options, io)));
}

function registerProfileAutopilotCommands(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  memory
    .command('reconcile-profile')
    .description('merge an explicit high-confidence cross-task preference into the profile')
    .option('--key <key>', 'stable profile dimension key')
    .option('--conclusion <text>', 'current conclusion')
    .option('--evidence <kind>', 'explicit')
    .option('--confidence <level>', 'high')
    .option('--user-directed', 'treat this explicit write as directly requested by the user')
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((options) => {
        const payload = resolveCommandPayload<ProfileOptions>(
          'memory reconcile-profile',
          options,
          reconcileProfilePayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          reconcileProfile(runtime, resolved, io),
        );
      }),
    );

  memory
    .command('forget-profile')
    .description('remove one canonical profile entry by exact key')
    .option('--key <key>', 'stable profile dimension key')
    .option('--payload-file <path>', 'read domain options from a bounded JSON file')
    .option('--consume-payload-file', 'delete the unchanged payload after schema validation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((options) => {
        const payload = resolveCommandPayload<RemoveProfileOptions>(
          'memory forget-profile',
          options,
          forgetProfilePayloadSchema,
        );
        return executeCommandPayload(payload, (resolved) =>
          removeProfileEntry(runtime, resolved, io),
        );
      }),
    );

  memory
    .command('profile-autopilot <action>')
    .description('pause or resume automatic canonical profile reconciliation')
    .option('--json', 'write a machine-readable result')
    .action(
      run((action: 'pause' | 'resume', options) => {
        if (!['pause', 'resume'].includes(action)) {
          throw new Error(`Invalid profile autopilot action: ${action}`);
        }
        return setProfileAutopilot(
          runtime,
          { state: action === 'pause' ? 'paused' : 'enabled', json: options.json },
          io,
        );
      }),
    );
}

export function registerMemoryAutopilotCommands(
  memory: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  registerProjectAutopilotCommands(memory, runtime, io, run);
  registerProfileAutopilotCommands(memory, runtime, io, run);
}
