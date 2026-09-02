import { relative, sep } from 'node:path';
import type { Io } from '../../types.js';
import type { ManagedMemoryEntry } from './memory-path.js';
import { isPortablePathComponent } from '../filesystem/portable-path-component.js';
import { containsHighConfidenceSecret } from '../security/secret-hygiene.js';

function isUnsafeDisplayCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069))
  );
}

export function containsUnsafeDisplayCharacters(value: string): boolean {
  return Array.from(value).some(isUnsafeDisplayCharacter);
}

export function sanitizeDiagnosticText(value: string): string {
  return Array.from(value, (character) =>
    isUnsafeDisplayCharacter(character) ? '�' : character,
  ).join('');
}

export function validatePortableMemoryPaths(
  root: string,
  entries: ManagedMemoryEntry[],
  io: Io,
): number {
  let failures = 0;
  const portablePaths = new Map<string, { path: string; secret: boolean }>();
  for (const { path } of entries) {
    const portablePath = relative(root, path).split(sep).join('/');
    if (containsUnsafeDisplayCharacters(portablePath)) {
      io.error('Managed memory path contains unsafe control or display-format characters');
      failures += 1;
    }
    const components = portablePath.split('/');
    if (components.some((component) => !isPortablePathComponent(component))) {
      io.error('Managed memory path contains a non-portable path component');
      failures += 1;
    }
    const archiveIndexes = components.flatMap((component, index) =>
      component.normalize('NFC').toLowerCase() === '_archive' ? [index] : [],
    );
    if (
      archiveIndexes.length > 0 &&
      !(archiveIndexes.length === 1 && archiveIndexes[0] === 0 && components[0] === '_archive')
    ) {
      io.error(`Managed memory archive path must use the top-level canonical _archive: ${path}`);
      failures += 1;
    }
    const secret = containsHighConfidenceSecret(portablePath);
    if (secret) {
      io.error('Managed memory path contains high-confidence secret material');
      failures += 1;
    }
    const identity = portablePath.normalize('NFC').toLowerCase();
    const existing = portablePaths.get(identity);
    if (existing && existing.path !== path) {
      io.error(
        existing.secret || secret
          ? 'Portable memory path collision involving a secret-bearing path'
          : `Portable memory path collision: ${existing.path} and ${path}`,
      );
      failures += 1;
    } else portablePaths.set(identity, { path, secret });
  }
  return failures;
}
