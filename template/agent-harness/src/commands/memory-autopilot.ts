import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { escapeCoreLabel, upsertCoreReference } from '../lib/memory-core.js';
import {
  assertHandoffOptions,
  assertHandoffSessionId,
  type CloseHandoffOptions,
  type HandoffOptions,
  reconcileHandoffOptions,
  removeHandoffCoreReference,
  renderHandoff,
  resolveHandoffTarget,
} from '../lib/memory-handoff.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import { memoryReference, readMemoryDocument, resolveMemoryRoot } from '../lib/memory-path.js';
import { validateMemoryPreflight } from '../lib/memory-preflight.js';
import {
  type MemoryWriteResult,
  output,
  validateUnchanged,
  writeValidated,
} from '../lib/memory-write.js';
import { withProjectMemoryTransaction } from '../lib/project-memory.js';
import { assertSafePath } from '../lib/safe-path.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export type { CloseHandoffOptions, HandoffOptions } from '../lib/memory-handoff.js';

export function captureHandoff(
  runtime: Runtime,
  project: string,
  options: HandoffOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([project], 'Memory handoff request');
  assertHandoffOptions(options);
  const date = calendarDate(runtime);
  const result = withProjectMemoryTransaction(
    runtime,
    project,
    ({ memoryRoot }) => {
      const sessionRoot = join(memoryRoot, 'sessions');
      const target = resolveHandoffTarget(memoryRoot, options.session, 'capture');
      const defaultPath = join(sessionRoot, ...date.split('-'), `${target.identity.sessionId}.md`);
      const path = target.path || defaultPath;
      assertSafePath(memoryRoot, path);
      const documentExists = existsSync(path);
      const existing = documentExists ? readMemoryDocument(path) : '';
      const metadata = parseFrontmatter(existing);
      const created = metadata.get('created');
      const storedUpdated = metadata.get('updated');
      const reference = `memory:${memoryReference(memoryRoot, path)}`;
      const reconciled = reconcileHandoffOptions(options, existing);
      let content = renderHandoff(
        runtime,
        reconciled,
        target.identity,
        memoryRoot,
        typeof created === 'string' ? created : date,
        typeof storedUpdated === 'string' ? storedUpdated : date,
        existing,
      );
      if (existing !== content) {
        content = renderHandoff(
          runtime,
          reconciled,
          target.identity,
          memoryRoot,
          typeof created === 'string' ? created : date,
          date,
          existing,
        );
      }
      const corePath = join(memoryRoot, 'core.md');
      assertSafePath(memoryRoot, corePath);
      const currentCore = readMemoryDocument(corePath);
      const core = upsertCoreReference(
        currentCore,
        'Recent Handoffs',
        `- ${escapeCoreLabel(options.title.trim())}；next: ${escapeCoreLabel(options.next.trim())}；${reference}`,
        reference,
        date,
      );
      const action = !documentExists
        ? 'created'
        : existing === content && currentCore === core
          ? 'unchanged'
          : 'updated';
      if (action !== 'unchanged') {
        const entries = [
          ...(existing === content ? [] : [{ path, content }]),
          ...(currentCore === core ? [] : [{ path: corePath, content: core }]),
        ];
        writeValidated(memoryRoot, entries, io, { rootKind: 'project' });
      } else validateUnchanged(memoryRoot, io, { rootKind: 'project' });
      return { version: 1, action, kind: 'episode', path, reference } as const;
    },
    { allowNonCanonicalReferences: true, allowHandoffIdentityDiagnostics: true },
  );
  return output(result, Boolean(options.json), io);
}

export function closeHandoff(
  runtime: Runtime,
  project: string,
  options: CloseHandoffOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([project, options.session], 'Memory handoff close request');
  assertHandoffSessionId(options.session);
  const memoryRoot = resolveMemoryRoot(runtime, project);
  if (!existsSync(memoryRoot)) throw new Error(`Project memory root does not exist: ${memoryRoot}`);
  return withMemoryLock(memoryRoot, () => {
    validateMemoryPreflight(memoryRoot, 'project', { allowNonCanonicalReferences: true });
    const target = resolveHandoffTarget(memoryRoot, options.session, 'close');
    const path = target.path;
    if (!path) throw new Error(`Handoff session does not exist: ${options.session}`);
    assertSafePath(memoryRoot, path);
    const existing = readMemoryDocument(path);
    const metadata = parseFrontmatter(existing);
    const status = String(metadata.get('status') || 'unknown');
    if (!['active', 'blocked', 'complete'].includes(status)) {
      throw new Error(`Cannot close ${status} handoff: ${options.session}`);
    }
    const reference = `memory:${memoryReference(memoryRoot, path)}`;
    const date = calendarDate(runtime);
    const content =
      status === 'complete'
        ? existing
        : updateFrontmatter(existing, { status: 'complete', updated: date });
    const corePath = join(memoryRoot, 'core.md');
    assertSafePath(memoryRoot, corePath);
    const existingCore = readMemoryDocument(corePath);
    const core = removeHandoffCoreReference(existingCore, reference, date);
    const action = content === existing && core === existingCore ? 'unchanged' : 'updated';
    if (action !== 'unchanged') {
      writeValidated(
        memoryRoot,
        [
          ...(content === existing ? [] : [{ path, content }]),
          ...(core === existingCore ? [] : [{ path: corePath, content: core }]),
        ],
        io,
        { rootKind: 'project' },
      );
    } else validateUnchanged(memoryRoot, io, { rootKind: 'project' });
    return output(
      { version: 1, action, kind: 'episode', path, reference },
      Boolean(options.json),
      io,
    );
  });
}
