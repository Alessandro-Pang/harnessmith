import { existsSync } from 'node:fs';
import { errorMessage, type Runtime } from '../types.js';
import { auditRoot, readAuditEvents } from './audit-store.js';

export function auditHealth(runtime: Runtime): {
  id: string;
  status: 'passed' | 'failed';
  message: string;
  details?: string[];
} {
  const root = auditRoot(runtime);
  if (!existsSync(root)) {
    return { id: 'audit', status: 'passed', message: 'Runtime audit is not configured' };
  }
  try {
    const events = readAuditEvents(runtime);
    return {
      id: 'audit',
      status: 'passed',
      message: `Runtime audit is valid with ${events.length} event(s)`,
      ...(events.length === 0
        ? {}
        : { details: [`latest event: ${events.at(-1)?.timestamp ?? 'unknown'}`] }),
    };
  } catch (error) {
    return { id: 'audit', status: 'failed', message: errorMessage(error), details: [root] };
  }
}
