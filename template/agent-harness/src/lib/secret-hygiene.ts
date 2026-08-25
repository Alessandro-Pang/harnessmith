import { readBoundedRegularFile } from './bounded-file.js';
import type { ListFilesOptions } from './file-discovery.js';
import { listFiles } from './files.js';

const highConfidenceSecretPatterns = [
  /-----BEGIN (?:(?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/,
  /\b(?:AKIA[0-9A-Z]{16}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/,
  /\b(?:npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|sk_live_[A-Za-z0-9]{20,})\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
];

export function containsHighConfidenceSecret(value: string): boolean {
  return highConfidenceSecretPatterns.some((pattern) => pattern.test(value));
}

export function assertNoHighConfidenceSecret(
  values: Array<string | undefined>,
  subject: string,
): void {
  if (values.some((value) => value !== undefined && containsHighConfidenceSecret(value))) {
    throw new Error(`${subject} contains high-confidence secret material`);
  }
}

export function assertNoHighConfidenceSecretInValue(value: unknown, subject: string): void {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      assertNoHighConfidenceSecret([current], subject);
      continue;
    }
    if (current === null || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) pending.push(...current);
    else {
      for (const [key, nested] of Object.entries(current)) pending.push(key, nested);
    }
  }
}

interface SecretScanOptions extends ListFilesOptions {
  exclude?: (path: string) => boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

function secretScanLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error(`Invalid secret scan ${name}: ${limit}`);
  return limit;
}

export function secretTextFiles(
  root: string,
  excluded: Set<string> = new Set(),
  options: SecretScanOptions = {},
): string[] {
  const maxFileBytes = secretScanLimit(options.maxFileBytes, 1024 * 1024, 'maxFileBytes');
  const maxTotalBytes = secretScanLimit(options.maxTotalBytes, 8 * 1024 * 1024, 'maxTotalBytes');
  let totalBytes = 0;
  const secretFiles: string[] = [];
  for (const path of listFiles(root, options)) {
    if (options.exclude?.(path) || excluded.has(path)) {
      continue;
    }
    const remaining = maxTotalBytes - totalBytes;
    if (remaining < 1) {
      throw new Error(`Secret scan total byte budget exceeded: ${path}`);
    }
    let result: ReturnType<typeof readBoundedRegularFile>;
    try {
      result = readBoundedRegularFile(path, {
        maxBytes: Math.min(maxFileBytes, remaining),
        subject: 'Secret scan file',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (remaining < maxFileBytes && /exceeds \d+ bytes/.test(message)) {
        throw new Error(`Secret scan total byte budget exceeded: ${path}`, { cause: error });
      }
      if (/exceeds \d+ bytes/.test(message)) {
        throw new Error(`Secret scan file byte budget exceeded: ${path}`, { cause: error });
      }
      throw error;
    }
    totalBytes += result.bytes;
    if (containsHighConfidenceSecret(result.content)) secretFiles.push(path);
  }
  return secretFiles;
}
