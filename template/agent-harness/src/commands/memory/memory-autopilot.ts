import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFrontmatter, updateFrontmatter } from '../../lib/documentation/frontmatter.js';
import { escapeCoreLabel, upsertCoreReference } from '../../lib/memory/memory-core.js';
import {
  assertHandoffOptions,
  assertHandoffSessionId,
  type CloseHandoffOptions,
  type HandoffOptions,
  reconcileHandoffOptions,
  removeHandoffCoreReference,
  renderHandoff,
  resolveHandoffTarget,
} from '../../lib/memory/memory-handoff.js';
import { withMemoryLock } from '../../lib/memory/memory-lock.js';
import {
  memoryReference,
  readMemoryDocument,
  resolveMemoryRoot,
} from '../../lib/memory/memory-path.js';
import { validateMemoryPreflight } from '../../lib/memory/memory-preflight.js';
import {
  type MemoryWriteResult,
  output,
  validateUnchanged,
  writeValidated,
} from '../../lib/memory/memory-write.js';
import { withProjectMemoryTransaction } from '../../lib/project/project-memory.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import { readTask } from '../../lib/task/task-store.js';
import { assertRuntimeCanMutate, calendarDate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

export type { CloseHandoffOptions, HandoffOptions } from '../../lib/memory/memory-handoff.js';

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
      if (reconciled.taskId) {
        const task = readTask(dirname(memoryRoot), reconciled.taskId).value;
        if (['complete', 'superseded'].includes(task.status)) {
          throw new Error(`Cannot capture a handoff for closed task ${task.id}`);
        }
        if (reconciled.next.trim() !== task.nextAction.trim()) {
          throw new Error(`Handoff next must match task ${task.id} nextAction`);
        }
        reconciled.sourceRefs = [
          ...new Set([...(reconciled.sourceRefs ?? []), `task:${reconciled.taskId}`]),
        ];
      }
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
        reconciled.taskId
          ? `- ${escapeCoreLabel(options.title.trim())}；task: ${escapeCoreLabel(reconciled.taskId)}；${reference}`
          : `- ${escapeCoreLabel(options.title.trim())}；next: ${escapeCoreLabel(options.next.trim())}；${reference}`,
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
  if (!options.outcome) throw new Error('Handoff workstream outcome is required');
  if (!['completed', 'cancelled'].includes(options.outcome)) {
    throw new Error(`Invalid handoff workstream outcome: ${String(options.outcome)}`);
  }
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
    const taskId = metadata.get('task-id');
    if (typeof taskId === 'string') {
      const task = readTask(dirname(memoryRoot), taskId).value;
      if (!['complete', 'superseded'].includes(task.status)) {
        throw new Error(`Cannot close handoff while task ${task.id} is ${task.status}`);
      }
    }
    if (options.outcome === 'completed' && /^# 未解决事项$/mu.test(existing)) {
      throw new Error('Cannot complete a handoff with unresolved open items');
    }
    const reference = `memory:${memoryReference(memoryRoot, path)}`;
    const date = calendarDate(runtime);
    const content =
      status === 'complete'
        ? existing
        : updateFrontmatter(existing, {
            status: 'complete',
            updated: date,
            'closed-outcome': options.outcome,
          });
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
