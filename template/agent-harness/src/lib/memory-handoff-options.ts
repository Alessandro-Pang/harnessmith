import { isAtxHeading } from './markdown-heading.js';
import type { HandoffOptions } from './memory-handoff.js';
import { assertHandoffSessionId } from './memory-handoff-identity.js';
import { assertNoHighConfidenceSecret } from './secret-hygiene.js';
import { assertTaskId } from './task-model.js';

export const canonicalHandoffSectionTitles = [
  '当前目标',
  '已确认事实',
  '已完成',
  '关键决策',
  '验证证据',
  '未解决事项',
  '下一步',
] as const;

function assertNoCanonicalHeading(value: string | undefined, option: string): void {
  if (!value) return;
  if (
    value
      .split(/\r?\n/)
      .some((line) => canonicalHandoffSectionTitles.some((title) => isAtxHeading(line, 1, title)))
  ) {
    throw new Error(`Handoff ${option} cannot contain a canonical section heading`);
  }
}

export function assertHandoffOptions(options: HandoffOptions): void {
  assertNoHighConfidenceSecret(
    [
      options.session,
      options.taskId,
      options.title,
      options.objective,
      options.completed,
      options.facts || '',
      options.decisions || '',
      options.verification || '',
      options.open || '',
      options.next,
      options.reason,
      options.status,
      ...(options.scope || []),
      ...(options.sourceRefs || []),
    ],
    'Memory handoff',
  );
  assertHandoffSessionId(options.session);
  if (options.taskId !== undefined) assertTaskId(options.taskId);
  for (const [name, value] of Object.entries({
    session: options.session,
    title: options.title,
    objective: options.objective,
    completed: options.completed,
    next: options.next,
    reason: options.reason,
  })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Handoff ${name} is required`);
  }
  if (/\r|\n/.test(options.title) || /\r|\n/.test(options.next)) {
    throw new Error('Handoff title and next must each be a single line');
  }
  if (options.title.trim().length > 200 || options.next.trim().length > 500) {
    throw new Error('Handoff title or next exceeds its length limit');
  }
  for (const [name, value] of Object.entries({
    objective: options.objective,
    completed: options.completed,
    facts: options.facts,
    decisions: options.decisions,
    verification: options.verification,
    open: options.open,
    next: options.next,
  })) {
    assertNoCanonicalHeading(value, name);
  }
  if (!['phase', 'compaction', 'multi-task', 'manual'].includes(options.reason)) {
    throw new Error(`Invalid handoff checkpoint reason: ${options.reason}`);
  }
  if (options.status !== undefined && !['active', 'blocked'].includes(options.status)) {
    throw new Error(`Invalid handoff status: ${options.status}`);
  }
}
