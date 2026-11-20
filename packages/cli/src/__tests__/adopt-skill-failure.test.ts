import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';

const skills = vi.hoisted(() => ({ installSkills: vi.fn(), uninstallSkills: vi.fn() }));
vi.mock('../installation/skills.js', () => skills);

import { createAdapter } from '../adapters/adapters.js';
import { applyAdoptPlan, createAdoptPlan } from '../adoption/adopt.js';
import { HarnessmithError } from '../shared/types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-adopt-skill-failure-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'adopt-skill-failure-test',
  };
  return { root, env };
}

test('a failed skill install during adopt keeps the committed Host files and overlay', () => {
  const { root, env } = fixture();
  const source = join(root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '# Existing rules\n');
  const adapter = createAdapter('codex', { env });
  const proposal = createAdoptPlan([adapter], env).report;
  skills.installSkills.mockImplementationOnce(() => {
    throw new Error('agent directory is read-only');
  });

  let caught: unknown;
  try {
    applyAdoptPlan([adapter], env, { proposal: proposal.proposalId, initGlobal: false });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof HarnessmithError);
  assert.equal(caught.code, 'INTERNAL_ERROR');
  assert.equal(caught.reason, 'skill-install-failed');
  assert.match(caught.message, /skill installation failed.*remain installed/s);
  assert.match(readFileSync(source, 'utf8'), /managed-by: harnessmith/);
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  const personal = readFileSync(join(root, 'personal-harness', 'AGENTS.md'), 'utf8');
  assert.match(personal, /Existing rules/);
  assert.match(personal, /harnessmith-adopt:start/);
  assert.ok(proposal.backups.every(({ path }: { path: string }) => existsSync(path)));
});
