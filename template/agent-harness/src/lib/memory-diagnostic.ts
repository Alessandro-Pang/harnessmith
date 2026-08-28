import type { Io } from '../types.js';

export type MemoryDiagnosticCode =
  | 'non-canonical-reference'
  | 'input-identity'
  | 'handoff-identity';

export function reportMemoryDiagnostic(io: Io, code: MemoryDiagnosticCode, message: string): void {
  io.error(message, { memoryDiagnosticCode: code });
}

export function memoryDiagnosticCode(value: unknown): MemoryDiagnosticCode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as { memoryDiagnosticCode?: unknown }).memoryDiagnosticCode;
  return ['non-canonical-reference', 'input-identity', 'handoff-identity'].includes(String(code))
    ? (code as MemoryDiagnosticCode)
    : undefined;
}
