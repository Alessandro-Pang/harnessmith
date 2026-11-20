import assert from 'node:assert/strict';
import { beforeEach, expect, test, vi } from 'vitest';

const { installAll, uninstallAll, installSkills, uninstallSkills } = vi.hoisted(() => ({
  installAll: vi.fn(() => [{ adapter: 'codex' }]),
  uninstallAll: vi.fn(() => [{ adapter: 'codex' }]),
  installSkills: vi.fn(),
  uninstallSkills: vi.fn(),
}));
vi.mock('../installation/install.js', () => ({ installAll }));
vi.mock('../installation/lifecycle.js', () => ({ uninstallAll }));
vi.mock('../installation/skills.js', () => ({ installSkills, uninstallSkills }));

import { installWithSkills, uninstallWithSkills } from '../installation/installation-workflow.js';

const adapters = [] as never[];
const env = { HOME: '/tmp/harnessmith-test' };

beforeEach(() => {
  installAll.mockClear();
  uninstallAll.mockClear();
  installSkills.mockReset();
  uninstallSkills.mockReset();
});

test('host files install before the separately owned skill', () => {
  const calls: string[] = [];
  installAll.mockImplementationOnce(() => {
    calls.push('host');
    return [];
  });
  installSkills.mockImplementationOnce(() => calls.push('skill'));

  assert.deepEqual(installWithSkills(adapters, { env }), []);
  assert.deepEqual(calls, ['host', 'skill']);
});

test('a skill installation failure explicitly preserves the committed Host installation', () => {
  installSkills.mockImplementationOnce(() => {
    throw new Error('agent directory is read-only');
  });

  expect(() => installWithSkills(adapters, { env })).toThrow(
    /Host instructions and user data were installed.*remain installed.*retry install/,
  );
  expect(installAll).toHaveBeenCalledOnce();
});

test('uninstall completes Host removal before attempting separately owned skill removal', () => {
  const calls: string[] = [];
  uninstallAll.mockImplementationOnce(() => {
    calls.push('host');
    return [];
  });
  uninstallSkills.mockImplementationOnce(() => calls.push('skill'));

  assert.deepEqual(uninstallWithSkills(adapters, {}, env), []);
  assert.deepEqual(calls, ['host', 'skill']);
});

test('a skill removal failure does not imply that Host files were restored', () => {
  uninstallSkills.mockImplementationOnce(() => {
    throw new Error('skill is modified');
  });

  expect(() => uninstallWithSkills(adapters, {}, env)).toThrow(
    /Host instructions were uninstalled.*remain committed.*skills CLI/,
  );
  expect(uninstallAll).toHaveBeenCalledOnce();
});
