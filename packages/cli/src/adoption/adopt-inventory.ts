import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { readInstallRecord } from '../installation/records.js';
import { digestPath } from '../shared/files.js';
import { entryExists } from '../shared/safe-path.js';
import type { Adapter, InstallRecord, ManagedOutput } from '../shared/types.js';
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
  record: InstallRecord | null,
  output: ManagedOutput,
  result: InventoryAccumulator,
): void {
  const checksum = digestPath(output.path);
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
  if (record) {
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

/** Import portable host rules into the personal overlay; unchanged managed files need no write. */
export function collectAdoptInventory(adapters: Adapter[]): InventoryAccumulator {
  const result: InventoryAccumulator = {
    inventory: [],
    imports: [],
    blocked: [],
    expectedOutputChecksums: {},
  };
  for (const scope of adapters) {
    // Keep read-only inventory useful for symlinks without weakening the install path gate:
    // readAdoptRule rejects the link itself, and the blocked proposal cannot be applied.
    const hasSymlinkOutput = scope.outputs.some(
      ({ path }) => entryExists(path) && lstatSync(path).isSymbolicLink(),
    );
    const record = hasSymlinkOutput ? null : readInstallRecord(scope);
    for (const output of scope.outputs) inventoryOutput(record, output, result);
  }
  return result;
}
