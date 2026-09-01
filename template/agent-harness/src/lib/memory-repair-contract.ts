import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { Io, Runtime } from '../types.js';
import { resolveMemoryRoot } from './memory-path.js';
import { validateMemoryRoot } from './memory-validation.js';
import { sameCanonicalPath } from './safe-path.js';
import type { SearchSource } from './search.js';

export type RepairAction =
  | 'initialize-missing-memory'
  | 'compact-core-index'
  | 'rebuild-derived-index'
  | 'clear-orphan-repair-marker'
  | 'restore-interrupted-core-repair';

export interface RepairProposal {
  proposalId: string;
  action: RepairAction;
  authority: string;
  affectedPaths: string[];
  backup: { required: boolean; strategy: string; recoveryPaths: string[] };
  prerequisites: string[];
  risk: 'low' | 'medium';
  verifier: { command: string; owner: 'harness'; expected: string };
  diagnosis: { status: string; reasonCode: string };
}

export interface MemoryRepairReport {
  version: 1;
  mode: 'diagnose-only';
  scope: string;
  root: string;
  mutation: { status: 'unchanged'; reasonCode: 'diagnose-only' };
  proposals: RepairProposal[];
  unresolved: Array<{
    fault: 'memory-validation' | 'repair-transaction';
    status: 'inconclusive';
    reasonCode: string;
    diagnostics: string[];
  }>;
}

export interface ApplyOptions {
  beforeVerify?: () => void;
}

export function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fileIdentity(path: string): object {
  if (!existsSync(path)) return { exists: false };
  const entry = lstatSync(path);
  return {
    exists: true,
    kind: entry.isFile() && !entry.isSymbolicLink() ? 'file' : 'unsafe',
    dev: entry.dev,
    ino: entry.ino,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    ctimeMs: entry.ctimeMs,
  };
}

export function memorySources(root: string): SearchSource[] {
  return [
    {
      root,
      label: 'memory',
      trust: 'untrusted',
      excludeDirectories: ['_archive', 'host-evals'],
    },
  ];
}

export function repairProposal(
  action: RepairAction,
  fields: Omit<RepairProposal, 'proposalId' | 'action'>,
  binding: object,
): RepairProposal {
  const proposalId = `sha256:${digest(JSON.stringify({ version: 1, action, fields, binding }))}`;
  return { proposalId, action, ...fields };
}

export function repairContext(runtime: Runtime, scope: string) {
  const root = resolveMemoryRoot(runtime, scope);
  const rootKind = sameCanonicalPath(root, runtime.memoryHome) ? 'global' : 'project';
  const required = [
    join(root, 'README.md'),
    join(root, 'core.md'),
    ...(rootKind === 'global' ? [join(root, 'profile.md')] : []),
  ];
  return { root, rootKind, required } as const;
}

export function compactCoreContent(content: string): string {
  return content
    .split(/(?<=\n)/u)
    .map((line) => {
      const references = [...line.matchAll(/memory:([A-Za-z0-9_./-]+)/g)];
      if (!line.startsWith('- ') || references.length !== 1) return line;
      return `- memory:${references[0][1]}${line.endsWith('\n') ? '\n' : ''}`;
    })
    .join('');
}

export function validationDiagnostics(root: string, rootKind: 'global' | 'project', _io: Io) {
  const diagnostics: string[] = [];
  const capture = (message: unknown = '') => diagnostics.push(String(message));
  try {
    validateMemoryRoot(root, { log: capture, error: capture }, { quietSuccess: true, rootKind });
    return { valid: true as const, diagnostics };
  } catch {
    return { valid: false as const, diagnostics };
  }
}
