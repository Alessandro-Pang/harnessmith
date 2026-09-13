import { chmodSync, closeSync, fsyncSync, ftruncateSync, openSync, writeSync } from 'node:fs';
import { readBoundedRegularFile } from '../filesystem/bounded-file.js';

const maximumAuditFileBytes = 4 * 1024 * 1024;

/**
 * Append a JSONL record and flush it before the accounting index is updated.
 * This keeps the record/index ordering recoverable after a process or host crash.
 */
export function appendAuditLine(path: string, line: string): void {
  const descriptor = openSync(path, 'a', 0o600);
  const bytes = Buffer.from(line, 'utf8');
  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Repair only an unterminated tail. Newline-delimited records before the tail
 * are independently verifiable; a file with no complete record fails closed.
 */
export function recoverIncompleteAuditTails(paths: string[]): void {
  for (const path of paths) {
    const content = readBoundedRegularFile(path, {
      maxBytes: maximumAuditFileBytes,
      subject: 'Audit log file',
    }).content;
    if (content.length === 0 || content.endsWith('\n')) continue;
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline < 0) {
      throw new Error(`Audit log contains no complete record: ${path}`);
    }
    const verifiedBytes = Buffer.byteLength(content.slice(0, lastNewline + 1), 'utf8');
    const descriptor = openSync(path, 'r+');
    try {
      ftruncateSync(descriptor, verifiedBytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(path, 0o600);
  }
}
