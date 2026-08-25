import { createHash } from 'node:crypto';
import {
  isPortableIdentityComponent,
  maximumPortableIdentityCharacters,
} from './portable-path-component.js';

export interface HandoffIdentity {
  sessionBase: string;
  generation: number;
  sessionId: string;
}

export function assertHandoffSessionId(session: string): void {
  if (!isPortableIdentityComponent(session, { minimumCharacters: 3 }) || session.endsWith('.md')) {
    throw new Error(`Invalid portable session id: ${session}`);
  }
}

function assertHandoffGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error(`Invalid handoff generation: ${String(generation)}`);
  }
}

export function generatedHandoffSessionId(sessionBase: string, generation: number): string {
  assertHandoffSessionId(sessionBase);
  assertHandoffGeneration(generation);
  if (generation === 1) return sessionBase;
  const suffix = `--g${generation}`;
  if (sessionBase.length + suffix.length <= maximumPortableIdentityCharacters) {
    return `${sessionBase}${suffix}`;
  }
  const digest = createHash('sha256').update(sessionBase).digest('hex').slice(0, 16);
  const marker = `--${digest}${suffix}`;
  const prefixLength = maximumPortableIdentityCharacters - marker.length;
  if (prefixLength < 1) throw new Error(`Handoff generation is too large: ${generation}`);
  return `${sessionBase.slice(0, prefixLength)}${marker}`;
}

export function handoffIdentityFromMetadata(metadata: Map<string, unknown>): HandoffIdentity {
  const sessionId = metadata.get('session-id');
  if (typeof sessionId !== 'string') throw new Error('Handoff session-id is missing');
  assertHandoffSessionId(sessionId);
  const storedBase = metadata.get('session-base');
  const storedGeneration = metadata.get('handoff-generation');
  if (storedBase === undefined && storedGeneration === undefined) {
    return { sessionBase: sessionId, generation: 1, sessionId };
  }
  if (typeof storedBase !== 'string' || typeof storedGeneration !== 'number') {
    throw new Error('Handoff generation identity is incomplete');
  }
  assertHandoffSessionId(storedBase);
  assertHandoffGeneration(storedGeneration);
  if (generatedHandoffSessionId(storedBase, storedGeneration) !== sessionId) {
    throw new Error('Handoff generation identity does not match session-id');
  }
  return { sessionBase: storedBase, generation: storedGeneration, sessionId };
}
