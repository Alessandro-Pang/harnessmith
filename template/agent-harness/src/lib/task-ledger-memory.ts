import { relative, sep } from 'node:path';
import type { Io } from '../types.js';
import { isPortableIdentityComponent } from './portable-path-component.js';

function validArchiveMonth(year: string | undefined, month: string | undefined): boolean {
  if (!/^\d{4}$/.test(year || '') || !/^\d{2}$/.test(month || '')) return false;
  const value = `${year}-${month}-01`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function hasTaskLedgerMarker(metadata: Map<string, unknown>): boolean {
  const tags = metadata.get('tags');
  return Array.isArray(tags) && tags.includes('task-ledger');
}

export function canonicalTaskLedgerId(
  root: string,
  path: string,
  metadata: Map<string, unknown>,
): string | undefined {
  if (!hasTaskLedgerMarker(metadata)) return undefined;
  if (metadata.get('type') !== 'working-note' || metadata.get('memory-kind') !== 'working') {
    return undefined;
  }
  const parts = relative(root, path).split(sep);
  const live = parts.length === 3 && parts[0] === 'working' && parts[2] === 'progress.md';
  const archived =
    parts.length === 6 &&
    parts[0] === '_archive' &&
    validArchiveMonth(parts[1], parts[2]) &&
    parts[3] === 'working' &&
    parts[5] === 'progress.md';
  if (!live && !archived) return undefined;
  const taskId = live ? parts[1] : parts[4];
  if (!isPortableIdentityComponent(taskId)) return undefined;
  const sourceRefs = metadata.get('source-refs');
  if (!Array.isArray(sourceRefs) || sourceRefs.length !== 1 || sourceRefs[0] !== `task:${taskId}`) {
    return undefined;
  }
  return taskId;
}

export function validateTaskLedgerMemory(
  root: string,
  path: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  if (!hasTaskLedgerMarker(metadata) || canonicalTaskLedgerId(root, path, metadata)) return 0;
  io.error(
    `Task-ledger memory must use its canonical live or archived progress path and schema: ${path}`,
  );
  return 1;
}
