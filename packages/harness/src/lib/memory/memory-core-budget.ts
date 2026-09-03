import type { Io } from '../../types.js';

const memoryCoreSoftLineLimit = 160;
const memoryCoreHardLineLimit = 240;
export const memoryCoreSoftByteLimit = 24 * 1024;
export const memoryCoreHardByteLimit = 48 * 1024;
export const memoryCoreMaxEntryBytes = 512;

export interface MemoryCoreBudgetReport {
  lines: number;
  bytes: number;
  status: 'ok' | 'soft-limit' | 'hard-limit';
  limits: {
    softLines: number;
    hardLines: number;
    softBytes: number;
    hardBytes: number;
    maxEntryBytes: number;
  };
  compressionCandidates: string[];
}

function logicalLines(content: string): string[] {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function references(line: string): string[] {
  return [...line.matchAll(/memory:([A-Za-z0-9_./-]+)/g)].map((match) => match[1]);
}

export function memoryCoreBudget(content: string): MemoryCoreBudgetReport {
  const lines = logicalLines(content);
  const bytes = Buffer.byteLength(content);
  const status =
    lines.length > memoryCoreHardLineLimit || bytes > memoryCoreHardByteLimit
      ? 'hard-limit'
      : lines.length > memoryCoreSoftLineLimit || bytes > memoryCoreSoftByteLimit
        ? 'soft-limit'
        : 'ok';
  const candidates = lines
    .filter((line) => line.startsWith('- ') && references(line).length === 1)
    .map((line) => ({ reference: references(line)[0], bytes: Buffer.byteLength(line) }))
    .sort(
      (left, right) => right.bytes - left.bytes || left.reference.localeCompare(right.reference),
    );
  return {
    lines: lines.length,
    bytes,
    status,
    limits: {
      softLines: memoryCoreSoftLineLimit,
      hardLines: memoryCoreHardLineLimit,
      softBytes: memoryCoreSoftByteLimit,
      hardBytes: memoryCoreHardByteLimit,
      maxEntryBytes: memoryCoreMaxEntryBytes,
    },
    compressionCandidates:
      status === 'ok' ? [] : candidates.map(({ reference }) => `memory:${reference}`),
  };
}

function normalizedReference(reference: string): string {
  return reference.replace(/\.md$/, '').replace(/^\.\//, '').toLowerCase();
}

export function validateMemoryCoreContract(
  path: string,
  content: string,
  body: string,
  io: Io,
): number {
  let failures = 0;
  const budget = memoryCoreBudget(content);
  if (budget.status === 'hard-limit') {
    io.error(
      `Memory core exceeds its hard context budget (${budget.lines} lines, ${budget.bytes} bytes): ${path}`,
    );
    failures += 1;
  } else if (budget.status === 'soft-limit') {
    io.error(
      `WARNING Memory core exceeds its soft context budget (${budget.lines} lines, ${budget.bytes} bytes): ${path}`,
    );
  }

  const seen = new Set<string>();
  for (const line of body.replaceAll('\r\n', '\n').split('\n')) {
    if (!line.startsWith('- ')) continue;
    const pointers = references(line);
    const placeholder = /^- <[^\r\n]+创建后补充 memory 引用>$/.test(line);
    if (placeholder) continue;
    if (Buffer.byteLength(line) > memoryCoreMaxEntryBytes) {
      io.error(`Memory core entry exceeds its byte limit: ${path}`);
      failures += 1;
    }
    if (pointers.length !== 1 || (line.match(/memory:/g) ?? []).length !== 1) {
      io.error(`Memory core entry must contain exactly one canonical pointer: ${path}`);
      failures += 1;
      continue;
    }
    const identity = normalizedReference(pointers[0]);
    if (seen.has(identity)) {
      io.error(`Memory core contains a duplicate pointer: memory:${pointers[0]}: ${path}`);
      failures += 1;
    }
    seen.add(identity);
  }
  return failures;
}
