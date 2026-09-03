import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { digestManagedOutput, readInstallRecord } from '../installation/records.js';
import type { Adapter, InstallRecord } from '../shared/types.js';
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

function inventoryHarness(
  adapter: Adapter,
  record: InstallRecord | null,
  checksum: string | null,
  result: InventoryAccumulator,
): void {
  const entry = lstatSync(adapter.harness);
  const reasonCode = entry.isSymbolicLink()
    ? 'SYMLINK_REJECTED'
    : 'MANAGED_DISTRIBUTION_NOT_IMPORTABLE';
  const item: AdoptInventoryItem = {
    path: adapter.harness,
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

function inventoryOutput(
  adapter: Adapter,
  record: InstallRecord | null,
  output: string,
  result: InventoryAccumulator,
): void {
  const checksum = digestManagedOutput(adapter, output);
  result.expectedOutputChecksums[output] = checksum;
  if (!existsSync(output)) {
    result.inventory.push({
      path: output,
      owner: 'unknown',
      classification: 'managed-compatible',
      reasonCode: 'DESTINATION_MISSING',
      proposal: 'create-managed-output',
      checksum,
    });
    return;
  }
  if (record?.outputs.find(({ path }) => path === output)?.checksum === checksum) {
    result.inventory.push({
      path: output,
      owner: 'harnessmith',
      classification: 'managed-compatible',
      reasonCode: 'RECORDED_CHECKSUM_MATCH',
      proposal: 'no-change',
      checksum,
    });
    return;
  }
  if (output === adapter.harness) {
    inventoryHarness(adapter, record, checksum, result);
  } else if (record) {
    addBlocked(result, {
      path: output,
      owner: 'harnessmith',
      classification: 'conflict-rule',
      reasonCode: 'MANAGED_RULE_MODIFIED',
      proposal: 'inspect-and-resolve-before-adopt',
      checksum,
    });
  } else inventoryPortableRule(output, checksum, result);
}

export function collectAdoptInventory(adapters: Adapter[]): InventoryAccumulator {
  const result: InventoryAccumulator = {
    inventory: [],
    imports: [],
    blocked: [],
    expectedOutputChecksums: {},
  };
  for (const adapter of adapters) {
    const outputs = [adapter.harness, ...adapter.instructions.map(({ path }) => path)];
    const hasSymlink = outputs.some(
      (output) => existsSync(output) && lstatSync(output).isSymbolicLink(),
    );
    const record = hasSymlink ? null : readInstallRecord(adapter);
    for (const output of outputs) {
      inventoryOutput(adapter, record, output, result);
    }
  }
  return result;
}
