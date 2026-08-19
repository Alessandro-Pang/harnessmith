import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

export function atomicWrite(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic.sync(path, content, { encoding: 'utf8', mode });
}

export function atomicWriteMany(
  entries: Array<{ path: string; content: string; mode?: number }>,
): void {
  const snapshots = entries.map(({ path }) =>
    existsSync(path)
      ? { existed: true, content: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 }
      : { existed: false, content: '', mode: 0o644 },
  );
  let written = 0;
  try {
    for (const entry of entries) {
      atomicWrite(entry.path, entry.content, entry.mode);
      written += 1;
    }
  } catch (error) {
    for (let index = written - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const snapshot = snapshots[index];
      if (snapshot.existed) atomicWrite(entry.path, snapshot.content, snapshot.mode);
      else rmSync(entry.path, { force: true });
    }
    throw error;
  }
}

export function writeIfMissing(path: string, content: string, mode = 0o644): boolean {
  if (existsSync(path)) return false;
  atomicWrite(path, content, mode);
  return true;
}

export function listFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

export function sameText(path: string, expected: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8') === expected;
}

export function shortDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
}
