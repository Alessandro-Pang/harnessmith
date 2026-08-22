import { lstatSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
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

interface SecretScanOptions extends ListFilesOptions {
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
  const textExtensions = new Set([
    '.json',
    '.key',
    '.log',
    '.pem',
    '.toml',
    '.txt',
    '.yaml',
    '.yml',
  ]);
  const maxFileBytes = secretScanLimit(options.maxFileBytes, 1024 * 1024, 'maxFileBytes');
  const maxTotalBytes = secretScanLimit(options.maxTotalBytes, 8 * 1024 * 1024, 'maxTotalBytes');
  let totalBytes = 0;
  return listFiles(root, options).filter((path) => {
    if (
      excluded.has(path) ||
      (!textExtensions.has(extname(path).toLowerCase()) && !basename(path).startsWith('.env'))
    ) {
      return false;
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Secret scan expected a regular file: ${path}`);
    }
    if (stat.size > maxFileBytes) throw new Error(`Secret scan file byte budget exceeded: ${path}`);
    if (stat.size > maxTotalBytes - totalBytes) {
      throw new Error(`Secret scan total byte budget exceeded: ${path}`);
    }
    totalBytes += stat.size;
    return containsHighConfidenceSecret(readFileSync(path, 'utf8'));
  });
}
