import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Io, Runtime } from '../../types.js';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const sourceHarnessRoot = join(packageRoot, 'template', 'agent-harness');

export interface CapturedIo extends Io {
  logs: string[];
  errors: string[];
}

export function capturedIo(): CapturedIo {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log(message: unknown = '') {
      logs.push(String(message));
    },
    error(message: unknown = '') {
      errors.push(String(message));
    },
  };
}

export function harnessRuntime(root: string, overrides: Partial<Runtime> = {}): Runtime {
  const home = join(root, 'home');
  const harnessHome = join(root, 'host');
  const installedHarness = join(harnessHome, 'agent-harness');
  mkdirSync(home, { recursive: true });
  return Object.freeze({
    env: { HOME: home, TZ: 'UTC' },
    home,
    harnessRoot: sourceHarnessRoot,
    distributionRoot: join(packageRoot, 'template'),
    harnessHome,
    hostAdapter: 'test',
    instructionFiles: [join(harnessHome, 'AGENTS.md')],
    installedHarness,
    docsRoot: join(installedHarness, 'docs'),
    memoryHome: join(root, 'memory'),
    personalHome: join(root, 'personal'),
    repositoryRoot: join(root, 'repositories'),
    owner: 'test-owner',
    identityOverride: 'test-fixture',
    ...overrides,
  });
}
