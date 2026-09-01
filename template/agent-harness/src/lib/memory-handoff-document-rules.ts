import { relative, sep } from 'node:path';
import type { Io } from '../types.js';
import { isAtxHeading } from './markdown-heading.js';
import { reportMemoryDiagnostic } from './memory-diagnostic.js';
import { assertHandoffSessionId, handoffIdentityFromMetadata } from './memory-handoff-identity.js';

const handoffSections = [
  '当前目标',
  '已确认事实',
  '已完成',
  '关键决策',
  '验证证据',
  '未解决事项',
  '下一步',
] as const;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateTypedHandoff(
  root: string,
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  if (metadata.get('snapshot-mode') !== 'replace') return 0;
  const issues: string[] = [];
  if (metadata.get('type') !== 'session-handoff' || metadata.get('memory-kind') !== 'episode') {
    issues.push('type and memory-kind');
  }
  if (metadata.has('fact-class') && metadata.get('fact-class') !== 'recovery-state') {
    issues.push('fact-class');
  }
  if (metadata.has('fact-class') && metadata.get('expiry-policy') !== 'handoff-lifecycle') {
    issues.push('expiry-policy');
  }
  const session = metadata.get('session-id');
  let validSession = true;
  try {
    if (typeof session !== 'string') throw new Error('missing');
    assertHandoffSessionId(session);
  } catch {
    validSession = false;
    issues.push('session-id');
  }
  if (validSession) {
    try {
      handoffIdentityFromMetadata(metadata);
    } catch {
      issues.push('generation identity');
    }
  }
  const parts = relative(root, path).split(sep);
  const filename = typeof session === 'string' ? `${session}.md` : '';
  const livePath =
    parts.length === 5 &&
    parts[0] === 'sessions' &&
    isValidDate(parts.slice(1, 4).join('-')) &&
    parts[4] === filename;
  const archivedPath =
    parts.length === 8 &&
    parts[0] === '_archive' &&
    isValidDate(`${parts[1]}-${parts[2]}-01`) &&
    parts[3] === 'sessions' &&
    isValidDate(parts.slice(4, 7).join('-')) &&
    parts[7] === filename;
  const status = String(metadata.get('status'));
  if ((status === 'archived' && !archivedPath) || (status !== 'archived' && !livePath)) {
    issues.push('canonical path');
  }
  if (metadata.get('session-queryable') !== false) issues.push('session-queryable');
  if (
    !['phase', 'compaction', 'multi-task', 'manual'].includes(
      String(metadata.get('checkpoint-reason')),
    )
  ) {
    issues.push('checkpoint-reason');
  }
  if (!['active', 'blocked', 'complete', 'archived'].includes(status)) issues.push('status');
  const lines = body.split(/\r?\n/);
  let priorIndex = -1;
  for (const section of handoffSections) {
    const heading = `# ${section}`;
    const indexes = lines.flatMap((line, index) => (isAtxHeading(line, 1, section) ? [index] : []));
    const required = section === '当前目标' || section === '已完成' || section === '下一步';
    if (indexes.length > 1 || (required && indexes.length !== 1)) {
      issues.push(heading);
      continue;
    }
    if (indexes.length === 0) continue;
    const [index] = indexes;
    if (lines[index] !== heading) issues.push(`${heading} canonical`);
    if (index <= priorIndex) issues.push(`${heading} order`);
    priorIndex = index;
    const next = lines.findIndex(
      (line, lineIndex) =>
        lineIndex > index && handoffSections.some((title) => isAtxHeading(line, 1, title)),
    );
    if (
      !lines
        .slice(index + 1, next < 0 ? lines.length : next)
        .join('\n')
        .trim()
    ) {
      issues.push(`${heading} content`);
    }
  }
  for (const issue of issues) {
    reportMemoryDiagnostic(io, 'handoff-identity', `Invalid typed handoff ${issue}: ${path}`);
  }
  return issues.length;
}
