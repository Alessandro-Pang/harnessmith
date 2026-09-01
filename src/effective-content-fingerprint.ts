import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Adapter } from './types.js';

interface FingerprintBudget {
  entries: number;
  bytes: number;
  deadline: number;
}

interface Replacement {
  value: string;
  token: string;
  contextOnly: boolean;
}

const fingerprintLimits = {
  maxEntries: 100_000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxDepth: 64,
  maxDurationMs: 30_000,
};

function portable(path: string): string {
  return path.replaceAll(sep, '/');
}

function replacements(adapter: Adapter): Replacement[] {
  const contextPath = join(adapter.harness, 'install-context.json');
  if (!existsSync(contextPath)) return [];
  let context: Record<string, unknown>;
  try {
    context = JSON.parse(readFileSync(contextPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return [];
  }
  const values: Replacement[] = [];
  for (const [key, token] of [
    ['harnessHome', '{{HARNESS_HOME}}'],
    ['memoryHome', '{{HARNESS_MEMORY_HOME}}'],
    ['personalHome', '{{HARNESS_PERSONAL_HOME}}'],
    ['repositoryRoot', '{{HARNESS_REPOSITORY_ROOT}}'],
  ] as const) {
    const value = context[key];
    if (typeof value === 'string' && value) values.push({ value, token, contextOnly: false });
  }
  const instructionFiles = context.instructionFiles;
  if (Array.isArray(instructionFiles)) {
    instructionFiles.forEach((value, index) => {
      if (typeof value === 'string' && value) {
        values.push({ value, token: `{{INSTRUCTION_FILE_${index}}}`, contextOnly: true });
      }
    });
  }
  if (typeof context.owner === 'string' && context.owner) {
    values.push({ value: context.owner, token: '{{HARNESS_OWNER}}', contextOnly: true });
  }
  return values.sort((left, right) => right.value.length - left.value.length);
}

function normalizedContent(
  content: Buffer,
  relative: string,
  substitutions: Replacement[],
): Buffer | string {
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) return content;
  const isContext = portable(relative) === 'install-context.json';
  return substitutions.reduce(
    (value, replacement) =>
      replacement.contextOnly && !isContext
        ? value
        : value.replaceAll(replacement.value, replacement.token),
    text,
  );
}

function reserve(budget: FingerprintBudget, path: string, depth: number, bytes = 0): void {
  if (Date.now() > budget.deadline) throw new Error(`Fingerprint time budget exceeded: ${path}`);
  if (depth > fingerprintLimits.maxDepth)
    throw new Error(`Fingerprint depth budget exceeded: ${path}`);
  budget.entries += 1;
  if (budget.entries > fingerprintLimits.maxEntries)
    throw new Error(`Fingerprint entry budget exceeded: ${path}`);
  if (bytes > fingerprintLimits.maxFileBytes)
    throw new Error(`Fingerprint file byte budget exceeded: ${path}`);
  budget.bytes += bytes;
  if (budget.bytes > fingerprintLimits.maxBytes)
    throw new Error(`Fingerprint total byte budget exceeded: ${path}`);
}

function hashOutput(
  hash: ReturnType<typeof createHash>,
  root: string,
  role: string,
  substitutions: Replacement[],
  budget: FingerprintBudget,
): void {
  if (!existsSync(root)) {
    hash.update(`missing:${role}\n`);
    return;
  }
  const pending = [{ path: root, relative: '', depth: 0 }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    const stat = lstatSync(item.path);
    const identity = `${role}/${portable(item.relative)}`;
    if (stat.isDirectory()) {
      reserve(budget, item.path, item.depth);
      hash.update(`directory:${identity}\n`);
      const children = readdirSync(item.path)
        .filter((name) => !(role === 'harness' && !item.relative && name === 'state'))
        .sort((left, right) => right.localeCompare(left))
        .map((name) => ({
          path: join(item.path, name),
          relative: item.relative ? join(item.relative, name) : name,
          depth: item.depth + 1,
        }));
      pending.push(...children);
    } else if (stat.isFile()) {
      reserve(budget, item.path, item.depth, stat.size);
      hash.update(`file:${identity}\n`);
      hash.update(normalizedContent(readFileSync(item.path), item.relative, substitutions));
    } else if (stat.isSymbolicLink()) {
      reserve(budget, item.path, item.depth);
      hash.update(`symlink:${identity}:${readlinkSync(item.path)}\n`);
    } else {
      reserve(budget, item.path, item.depth);
      hash.update(`special:${identity}\n`);
    }
  }
}

export function effectiveContentFingerprint(adapter: Adapter): string {
  const hash = createHash('sha256');
  const substitutions = replacements(adapter);
  const budget = {
    entries: 0,
    bytes: 0,
    deadline: Date.now() + fingerprintLimits.maxDurationMs,
  };
  hash.update(`adapter:${adapter.name}\n`);
  hashOutput(hash, adapter.harness, 'harness', substitutions, budget);
  adapter.instructions.forEach(({ path }, index) => {
    hashOutput(hash, path, `instruction:${index}`, substitutions, budget);
  });
  return `sha256:${hash.digest('hex')}`;
}
