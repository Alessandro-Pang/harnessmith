import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { digestManagedOutput, readInstallRecord } from '../installation/records.js';
import { entryExists } from '../shared/safe-path.js';
import type { Adapter, InstallRecord, ManagedOutput, ManagedScope } from '../shared/types.js';
import { containsAdoptSecret } from './adopt-secret.js';

const maxRuleBytes = 256 * 1024;

export interface AdoptInventoryItem {
  path: string;
  owner: 'harnessmith' | 'user' | 'host' | 'unknown';
  classification:
    | 'managed-compatible'
    | 'user-owned-overlay'
    | 'conflict-rule'
    | 'host-specific-config'
    | 'not-importable';
  reasonCode: string;
  proposal: string;
  checksum: string | null;
}

export interface AdoptImportCandidate {
  path: string;
  checksum: string;
  content: string;
}

export function adoptHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readAdoptRule(
  path: string,
): { ok: true; content: string; checksum: string } | { ok: false; reasonCode: string } {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) return { ok: false, reasonCode: 'SYMLINK_REJECTED' };
  if (!entry.isFile() || entry.size > maxRuleBytes) {
    return { ok: false, reasonCode: 'UNKNOWN_FORMAT' };
  }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) return { ok: false, reasonCode: 'UNKNOWN_FORMAT' };
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reasonCode: 'UNKNOWN_FORMAT' };
  }
  if (containsAdoptSecret(content)) return { ok: false, reasonCode: 'SECRET_DETECTED' };
  return { ok: true, content, checksum: adoptHash(content) };
}

function splitMdc(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---\n')) return { frontmatter: null, body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: null, body: content };
  return { frontmatter: content.slice(0, end + 5), body: content.slice(end + 5) };
}

interface InventoryAccumulator {
  inventory: AdoptInventoryItem[];
  imports: AdoptImportCandidate[];
  blocked: Array<{ path: string; reasonCode: string }>;
  expectedOutputChecksums: Record<string, string | null>;
}

function addBlocked(result: InventoryAccumulator, item: AdoptInventoryItem): void {
  result.inventory.push(item);
  result.blocked.push({ path: item.path, reasonCode: item.reasonCode });
}

/** Skill directories (hub tree or host skill link) carry no importable rules. */
function inventoryDistribution(
  path: string,
  record: InstallRecord | null,
  checksum: string | null,
  result: InventoryAccumulator,
): void {
  const entry = lstatSync(path);
  const reasonCode = entry.isSymbolicLink()
    ? 'SYMLINK_REJECTED'
    : 'MANAGED_DISTRIBUTION_NOT_IMPORTABLE';
  const item: AdoptInventoryItem = {
    path,
    owner: record ? 'harnessmith' : 'unknown',
    classification: record ? 'conflict-rule' : 'not-importable',
    reasonCode,
    proposal: entry.isSymbolicLink() ? 'blocked' : 'backup-and-replace',
    checksum,
  };
  if (entry.isSymbolicLink() || record) addBlocked(result, item);
  else result.inventory.push(item);
}

function inventoryPortableRule(
  output: string,
  checksum: string | null,
  result: InventoryAccumulator,
): void {
  const rule = readAdoptRule(output);
  if (!rule.ok) {
    addBlocked(result, {
      path: output,
      owner: 'unknown',
      classification: 'not-importable',
      reasonCode: rule.reasonCode,
      proposal: 'blocked',
      checksum,
    });
    return;
  }
  if (/managed-by:\s*harnessmith/i.test(rule.content)) {
    addBlocked(result, {
      path: output,
      owner: 'unknown',
      classification: 'conflict-rule',
      reasonCode: 'ORPHANED_MANAGED_RULE',
      proposal: 'inspect-and-resolve-before-adopt',
      checksum,
    });
    return;
  }
  const { frontmatter, body } =
    extname(output) === '.mdc' ? splitMdc(rule.content) : { frontmatter: null, body: rule.content };
  if (frontmatter) {
    result.inventory.push({
      path: output,
      owner: 'host',
      classification: 'host-specific-config',
      reasonCode: 'HOST_FRONTMATTER_EXCLUDED',
      proposal: 'preserve-in-backup-only',
      checksum: adoptHash(frontmatter),
    });
  }
  if (body.trim()) {
    result.inventory.push({
      path: output,
      owner: 'user',
      classification: 'user-owned-overlay',
      reasonCode: 'PORTABLE_MARKDOWN_RULES',
      proposal: 'append-to-personal-overlay',
      checksum: adoptHash(body),
    });
    result.imports.push({ path: output, checksum: rule.checksum, content: body });
  }
}

function isDistribution(scope: ManagedScope, output: ManagedOutput): boolean {
  if (output.kind === 'tree') return true;
  return output.kind === 'link' && scope.scope === 'adapter'
    ? output.target === (scope as Adapter).hub.harness
    : output.kind === 'link';
}

function inventoryOutput(
  scope: ManagedScope,
  record: InstallRecord | null,
  output: ManagedOutput,
  result: InventoryAccumulator,
): void {
  const checksum = digestManagedOutput(scope, output.path);
  result.expectedOutputChecksums[output.path] = checksum;
  if (!entryExists(output.path)) {
    result.inventory.push({
      path: output.path,
      owner: 'unknown',
      classification: 'managed-compatible',
      reasonCode: 'DESTINATION_MISSING',
      proposal: 'create-managed-output',
      checksum,
    });
    return;
  }
  if (record?.outputs.find(({ path }) => path === output.path)?.checksum === checksum) {
    result.inventory.push({
      path: output.path,
      owner: 'harnessmith',
      classification: 'managed-compatible',
      reasonCode: 'RECORDED_CHECKSUM_MATCH',
      proposal: 'no-change',
      checksum,
    });
    return;
  }
  if (isDistribution(scope, output)) {
    inventoryDistribution(output.path, record, checksum, result);
  } else if (record) {
    addBlocked(result, {
      path: output.path,
      owner: 'harnessmith',
      classification: 'conflict-rule',
      reasonCode: 'MANAGED_RULE_MODIFIED',
      proposal: 'inspect-and-resolve-before-adopt',
      checksum,
    });
  } else inventoryPortableRule(output.path, checksum, result);
}

/**
 * Inventory the hub once and every selected host: existing host rule files are import
 * candidates for the personal overlay; recorded managed outputs (including hub links whose
 * target still matches) need no change.
 */
export function collectAdoptInventory(adapters: Adapter[]): InventoryAccumulator {
  const result: InventoryAccumulator = {
    inventory: [],
    imports: [],
    blocked: [],
    expectedOutputChecksums: {},
  };
  const scopes: ManagedScope[] = [...(adapters[0] ? [adapters[0].hub] : []), ...adapters];
  for (const scope of scopes) {
    const record = readInstallRecord(scope);
    for (const output of scope.outputs) inventoryOutput(scope, record, output, result);
  }
  return result;
}
