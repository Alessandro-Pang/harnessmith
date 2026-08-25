import { basename, join, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { removeCoreReference } from './memory-core.js';
import {
  generatedHandoffSessionId,
  type HandoffIdentity,
  handoffIdentityFromMetadata,
} from './memory-handoff-identity.js';
import { markdownFiles, readMemoryDocument } from './memory-path.js';
import { assertSafePath } from './safe-path.js';

export {
  assertHandoffOptions,
  reconcileHandoffOptions,
  renderHandoff,
} from './memory-handoff-document.js';
export { assertHandoffSessionId } from './memory-handoff-identity.js';

export interface HandoffOptions {
  session: string;
  title: string;
  objective: string;
  completed: string;
  facts?: string;
  decisions?: string;
  verification?: string;
  open?: string;
  next: string;
  reason: 'phase' | 'compaction' | 'multi-task' | 'manual';
  status?: 'active' | 'blocked';
  scope?: string[];
  sourceRefs?: string[];
  clearFacts?: boolean;
  clearDecisions?: boolean;
  clearVerification?: boolean;
  clearOpen?: boolean;
  clearScope?: boolean;
  clearSourceRefs?: boolean;
  json?: boolean;
}

export interface CloseHandoffOptions {
  session: string;
  json?: boolean;
}

export interface HandoffTarget {
  identity: HandoffIdentity;
  path?: string;
}

interface HandoffCandidate {
  path: string;
  metadata: Map<string, unknown>;
  identity?: HandoffIdentity;
}

function portable(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function compatibleHandoff(metadata: Map<string, unknown>): boolean {
  const snapshotMode = metadata.get('snapshot-mode');
  const sessionQueryable = metadata.get('session-queryable');
  return (
    metadata.get('type') === 'session-handoff' &&
    metadata.get('memory-kind') === 'episode' &&
    (snapshotMode === undefined || snapshotMode === 'replace') &&
    (sessionQueryable === undefined || sessionQueryable === false)
  );
}

function handoffCandidates(memoryRoot: string): HandoffCandidate[] {
  return markdownFiles(memoryRoot).map((path) => {
    assertSafePath(memoryRoot, path);
    const metadata = parseFrontmatter(readMemoryDocument(path));
    if (!compatibleHandoff(metadata)) return { path, metadata };
    try {
      return { path, metadata, identity: handoffIdentityFromMetadata(metadata) };
    } catch {
      return { path, metadata };
    }
  });
}

function assertTargetIdentityAvailable(
  memoryRoot: string,
  candidates: HandoffCandidate[],
  target: HandoffTarget,
): void {
  const sessionRoot = join(memoryRoot, 'sessions');
  const targetIdentity = portable(target.identity.sessionId);
  for (const candidate of candidates) {
    const metadataSession = candidate.metadata.get('session-id');
    const metadataMatches =
      typeof metadataSession === 'string' && portable(metadataSession) === targetIdentity;
    const filenameMatches =
      candidate.path.startsWith(`${sessionRoot}${sep}`) &&
      portable(basename(candidate.path)) === `${targetIdentity}.md`;
    if (candidate.path === target.path) {
      if (metadataSession !== target.identity.sessionId || !filenameMatches) {
        throw new Error(
          `Handoff filename collision for ${target.identity.sessionBase}: ${candidate.path} declares a different session-id`,
        );
      }
      continue;
    }
    if (filenameMatches) {
      throw new Error(
        `Handoff filename collision for ${target.identity.sessionBase}: ${candidate.path} declares a different session-id`,
      );
    }
    if (metadataMatches) {
      throw new Error(
        `Handoff identity collision for ${target.identity.sessionBase}: ${candidate.path}`,
      );
    }
  }
}

export function resolveHandoffTarget(
  memoryRoot: string,
  sessionBase: string,
  intent: 'capture' | 'close',
): HandoffTarget {
  const portableBase = portable(sessionBase);
  const candidates = handoffCandidates(memoryRoot);
  const records: Array<HandoffCandidate & { identity: HandoffIdentity; status: string }> = [];
  for (const candidate of candidates) {
    const metadataSession = candidate.metadata.get('session-id');
    if (!candidate.identity) {
      if (typeof metadataSession === 'string' && portable(metadataSession) === portableBase) {
        throw new Error(`Handoff identity collision for ${sessionBase}: ${candidate.path}`);
      }
      continue;
    }
    if (portable(candidate.identity.sessionBase) === portableBase) {
      if (candidate.identity.sessionBase !== sessionBase) {
        throw new Error(`Handoff identity collision for ${sessionBase}: ${candidate.path}`);
      }
      records.push({
        ...candidate,
        identity: candidate.identity,
        status: String(candidate.metadata.get('status') || 'unknown'),
      });
      continue;
    }
    if (portable(candidate.identity.sessionId) === portableBase) {
      throw new Error(`Handoff identity collision for ${sessionBase}: ${candidate.path}`);
    }
  }

  records.sort(
    (left, right) =>
      left.identity.generation - right.identity.generation || left.path.localeCompare(right.path),
  );
  const generations = new Map<number, string>();
  for (const record of records) {
    const existing = generations.get(record.identity.generation);
    if (existing) {
      throw new Error(
        `Ambiguous handoff generation ${record.identity.generation} for ${sessionBase}: ${existing}, ${record.path}`,
      );
    }
    generations.set(record.identity.generation, record.path);
  }
  const active = records.filter((record) => ['active', 'blocked'].includes(record.status));
  if (active.length > 1) {
    throw new Error(
      `Ambiguous active handoff generations for ${sessionBase}: ${active.map((record) => record.path).join(', ')}`,
    );
  }
  const latest = records.at(-1);
  if (active[0] && active[0] !== latest) {
    throw new Error(
      `Invalid handoff lifecycle for ${sessionBase}: an older generation remains active`,
    );
  }

  let target: HandoffTarget;
  if (active[0]) {
    target = { path: active[0].path, identity: active[0].identity };
  } else if (intent === 'close') {
    if (!latest) throw new Error(`Handoff session does not exist: ${sessionBase}`);
    if (latest.status !== 'complete') {
      throw new Error(
        `Handoff session does not have an active generation: ${sessionBase} (${latest.status})`,
      );
    }
    target = { path: latest.path, identity: latest.identity };
  } else {
    if (latest && !['complete', 'archived'].includes(latest.status)) {
      throw new Error(`Cannot continue ${latest.status} handoff: ${sessionBase}`);
    }
    const generation = latest ? latest.identity.generation + 1 : 1;
    const sessionId = generatedHandoffSessionId(sessionBase, generation);
    target = { identity: { sessionBase, generation, sessionId } };
  }
  assertTargetIdentityAvailable(memoryRoot, candidates, target);
  return target;
}

export function removeHandoffCoreReference(
  content: string,
  reference: string,
  updated: string,
): string {
  return removeCoreReference(content, 'Recent Handoffs', reference, updated);
}
