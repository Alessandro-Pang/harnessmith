import type { Command } from 'commander';
import {
  archiveAudit,
  listAuditEvents,
  maintainAudit,
  recordAuditEvent,
  summarizeAudit,
} from '../commands/audit.js';
import type { AuditEventInput } from '../lib/audit-model.js';
import { executeCommandPayload, resolveCommandPayload } from '../lib/command-payload.js';
import type { Io, Runtime } from '../types.js';
import type { CommandRunner } from './types.js';

const auditPayloadSchema = {
  fields: {
    traceId: 'string',
    timestamp: 'string',
    operation: 'string',
    action: 'string',
    policyDecision: 'string',
    policyVersion: 'string',
    durationMs: 'number',
    outcome: 'string',
    artifactDigests: 'string[]',
    inputTokens: 'number',
    outputTokens: 'number',
    costUsd: 'number',
    errorCode: 'string',
  },
  required: [
    'traceId',
    'timestamp',
    'operation',
    'action',
    'policyDecision',
    'policyVersion',
    'durationMs',
    'outcome',
    'artifactDigests',
  ],
} as const;

function numericOption(value: string): number {
  return Number(value);
}

export function registerAuditCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  const audit = program
    .command('audit')
    .description('record and inspect privacy-safe runtime events');
  audit
    .command('record')
    .description('record one host-supplied runtime event')
    .requiredOption('--payload-file <path>', 'JSON event payload file')
    .option('--consume-payload-file', 'remove an accepted payload after recording')
    .option('--json', 'write a machine-readable result')
    .action(
      run((options: Record<string, unknown>) => {
        const resolved = resolveCommandPayload<AuditEventInput>(
          'audit record',
          options,
          auditPayloadSchema,
        );
        return executeCommandPayload(resolved, (event) => recordAuditEvent(runtime, event, io));
      }),
    );
  audit
    .command('list')
    .description('list bounded runtime events')
    .option('--trace-id <id>', 'filter by trace identifier')
    .option('--since <timestamp>', 'filter from canonical ISO-8601 UTC timestamp')
    .option('--limit <count>', 'return at most 500 latest matching events', numericOption)
    .option('--json', 'write a machine-readable result')
    .action(run((options) => listAuditEvents(runtime, options, io)));
  audit
    .command('summary')
    .description('aggregate outcomes, policy decisions, latency, tokens, and cost')
    .option('--since <timestamp>', 'filter from canonical ISO-8601 UTC timestamp')
    .option('--json', 'write a machine-readable result')
    .action(run((options) => summarizeAudit(runtime, options, io)));
  audit
    .command('maintain')
    .description('report stale or oversized active audit state')
    .option('--max-age-days <days>', 'active audit retention window', numericOption, 30)
    .option('--json', 'write a machine-readable result')
    .action(run((options) => maintainAudit(runtime, options, io)));
  audit
    .command('archive')
    .description('propose or archive active daily audit files before a date')
    .requiredOption('--before <date>', 'exclusive YYYY-MM-DD archive boundary')
    .option('--apply', 'move matching files into the retained archive')
    .option('--json', 'write a machine-readable result')
    .action(run((options) => archiveAudit(runtime, options, io)));
}
