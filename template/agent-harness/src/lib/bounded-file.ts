import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';

interface BoundedFileOptions {
  maxBytes: number;
  subject: string;
}

export function readBoundedRegularFile(
  input: string,
  { maxBytes, subject }: BoundedFileOptions,
): {
  path: string;
  content: string;
  bytes: number;
  identity: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
} {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`Invalid ${subject} byte limit: ${maxBytes}`);
  }
  const path = resolve(input);
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${subject} must be a regular non-symlink file: ${path}`);
  }
  if (entry.size > maxBytes) throw new Error(`${subject} exceeds ${maxBytes} bytes: ${path}`);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      before.size > maxBytes
    ) {
      throw new Error(`${subject} is not a bounded regular file: ${path}`);
    }
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let bytes = 0;
    while (true) {
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      if (length === 0) break;
      bytes += length;
      if (bytes > maxBytes) throw new Error(`${subject} exceeds ${maxBytes} bytes: ${path}`);
      chunks.push(Buffer.from(buffer.subarray(0, length)));
    }
    const after = fstatSync(descriptor);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(`${subject} changed while being read: ${path}`);
    }
    return {
      path,
      content: Buffer.concat(chunks, bytes).toString('utf8'),
      bytes,
      identity: {
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
      },
    };
  } finally {
    closeSync(descriptor);
  }
}
