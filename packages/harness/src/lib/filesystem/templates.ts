import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarDate } from '../../runtime.js';
import type { Runtime } from '../../types.js';

export function render(
  runtime: Runtime,
  content: string,
  extra: Record<string, string> = {},
): string {
  const values: Record<string, string> = {
    HOME: runtime.home,
    HARNESS_HOME: runtime.harnessHome,
    HARNESS_MEMORY_HOME: runtime.memoryHome,
    HARNESS_PERSONAL_HOME: runtime.personalHome,
    HARNESS_REPOSITORY_ROOT: runtime.repositoryRoot,
    HARNESS_OWNER: runtime.owner,
    DATE: calendarDate(runtime),
    ...extra,
  };
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function readTemplate(runtime: Runtime, path: string): string {
  const fullPath = join(runtime.harnessRoot, 'templates', path);
  if (!existsSync(fullPath)) throw new Error(`Missing template: ${fullPath}`);
  return readFileSync(fullPath, 'utf8');
}
