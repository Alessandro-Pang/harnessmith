import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { applyAdoptPlan, createAdoptPlan } from '../adoption/adopt.js';
import { canonicalPath } from '../shared/safe-path.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'adopt-test',
  };
  return { root, project, env };
}

function execute(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
}

function json(result: ReturnType<typeof execute>) {
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('adopt defaults to a read-only exact proposal and imports only after proposal-bound confirmation', () => {
  const { root, env } = fixture('harnessmith-adopt-global-');
  const source = join(root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '# My rules\n\n- Preserve focused changes.\n');

  const previewResult = execute(root, env, ['adopt', '--agent', 'codex', '--json']);
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = json(previewResult);
  assert.equal(preview.phase, 'proposal');
  assert.equal(preview.requiresConfirmation, true);
  assert.ok(
    preview.inventory.some(
      ({ classification }: { classification: string }) => classification === 'user-owned-overlay',
    ),
  );
  assert.match(preview.diff, /Preserve focused changes/);
  assert.ok(
    preview.backups.some(({ source: path }: { source: string }) => path === canonicalPath(source)),
    JSON.stringify(preview.backups),
  );
  assert.ok(preview.rollbackPaths.includes(canonicalPath(source)));
  assert.equal(readFileSync(source, 'utf8'), '# My rules\n\n- Preserve focused changes.\n');
  assert.equal(existsSync(join(root, 'personal-harness')), false);

  const appliedResult = execute(root, env, [
    'adopt',
    '--agent',
    'codex',
    '--proposal',
    preview.proposalId,
    '--yes',
    '--json',
  ]);
  assert.equal(appliedResult.status, 0, appliedResult.stderr);
  const applied = json(appliedResult);
  assert.equal(applied.phase, 'complete');
  assert.equal(applied.result, 'adopted');
  assert.match(readFileSync(source, 'utf8'), /managed-by: harnessmith/);
  const personal = readFileSync(join(root, 'personal-harness', 'AGENTS.md'), 'utf8');
  assert.match(personal, /Preserve focused changes/);
  assert.match(personal, /harnessmith-adopt:start/);
  assert.match(personal, new RegExp(preview.proposalId.slice(-12)));
  assert.ok(preview.backups.every(({ path }: { path: string }) => existsSync(path)));
});

test('adopt is idempotent after ownership and provenance are established', () => {
  const { root, env } = fixture('harnessmith-adopt-idempotent-');
  const source = join(root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '# Existing rules\n');
  const adapter = createAdapter('codex', { env });
  const proposal = createAdoptPlan([adapter], env).report;
  const applied = applyAdoptPlan([adapter], env, {
    proposal: proposal.proposalId,
    initGlobal: true,
  });
  assert.equal(applied.result, 'adopted');
  const record = join(root, 'codex-home', '.harnessmith', 'install.json');
  const recordBefore = readFileSync(record, 'utf8');
  const entriesBefore = readdirSync(join(root, 'codex-home')).sort();

  const repeated = createAdoptPlan([adapter], env).report;
  assert.equal(repeated.requiresWrite, false);
  assert.equal(repeated.inventory[0].classification, 'managed-compatible');
  assert.equal(readFileSync(record, 'utf8'), recordBefore);
  assert.deepEqual(readdirSync(join(root, 'codex-home')).sort(), entriesBefore);
});

test('adopt separates Cursor frontmatter from importable project rules', () => {
  const { root, project, env } = fixture('harnessmith-adopt-project-');
  const source = join(project, '.cursor', 'rules', 'agent-harness.mdc');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(
    source,
    '---\ndescription: Existing Cursor rules\nalwaysApply: true\n---\n# Project-neutral rule\n',
  );

  const adapter = createAdapter('cursor', { env, project });
  const proposal = createAdoptPlan([adapter], env).report;
  assert.ok(
    proposal.inventory.some(
      ({ classification }: { classification: string }) => classification === 'host-specific-config',
    ),
  );
  assert.ok(
    proposal.inventory.some(
      ({ classification }: { classification: string }) => classification === 'user-owned-overlay',
    ),
  );
  assert.ok(proposal.diff);
  assert.doesNotMatch(proposal.diff, /alwaysApply/);
  assert.match(proposal.diff, /Project-neutral rule/);

  const applied = applyAdoptPlan([adapter], env, {
    proposal: proposal.proposalId,
    initGlobal: true,
  });
  assert.equal(applied.result, 'adopted');
  assert.match(readFileSync(source, 'utf8'), /managed-by: harnessmith/);
  const personal = readFileSync(join(root, 'personal-harness', 'AGENTS.md'), 'utf8');
  assert.match(personal, /Project-neutral rule/);
  assert.doesNotMatch(personal, /alwaysApply/);
  assert.match(readFileSync(join(project, '.cursor', '.ignore'), 'utf8'), /agent-harness/);
  assert.ok(proposal.backups.every(({ path }: { path: string }) => existsSync(path)));
});

test('non-interactive adopt requires the exact proposal before any write', () => {
  const { root, env } = fixture('harnessmith-adopt-confirmation-');
  const source = join(root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '# unchanged\n');

  const result = execute(root, env, ['adopt', '--agent', 'codex', '--yes', '--json']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /CLI_USAGE/);
  assert.equal(readFileSync(source, 'utf8'), '# unchanged\n');
  assert.equal(existsSync(join(root, 'personal-harness')), false);
});

test('adopt fails closed on secrets, symlinks, binary content, and changed proposals', () => {
  const secretFixture = fixture('harnessmith-adopt-secret-');
  const secretSource = join(secretFixture.root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(secretSource), { recursive: true });
  const secret = ['ghp', '_', 'S'.repeat(24)].join('');
  writeFileSync(secretSource, `# rules\n${secret}\n`);
  const secretPlan = createAdoptPlan(
    [createAdapter('codex', { env: secretFixture.env })],
    secretFixture.env,
  ).report;
  assert.equal(secretPlan.blocked[0].reasonCode, 'SECRET_DETECTED');
  assert.doesNotMatch(JSON.stringify(secretPlan), new RegExp(secret));
  assert.equal(readFileSync(secretSource, 'utf8'), `# rules\n${secret}\n`);

  const symlinkFixture = fixture('harnessmith-adopt-symlink-');
  const outside = join(symlinkFixture.root, 'outside.md');
  writeFileSync(outside, '# outside\n');
  const symlinkSource = join(symlinkFixture.root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(symlinkSource), { recursive: true });
  symlinkSync(outside, symlinkSource);
  const symlinkPlan = createAdoptPlan(
    [createAdapter('codex', { env: symlinkFixture.env })],
    symlinkFixture.env,
  ).report;
  assert.equal(symlinkPlan.blocked[0].reasonCode, 'SYMLINK_REJECTED');
  assert.equal(lstatSync(symlinkSource).isSymbolicLink(), true);

  const binaryFixture = fixture('harnessmith-adopt-binary-');
  const binarySource = join(binaryFixture.root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(binarySource), { recursive: true });
  writeFileSync(binarySource, Buffer.from([0, 1, 2, 3]));
  const binaryPlan = createAdoptPlan(
    [createAdapter('codex', { env: binaryFixture.env })],
    binaryFixture.env,
  ).report;
  assert.equal(binaryPlan.blocked[0].reasonCode, 'UNKNOWN_FORMAT');

  const changedFixture = fixture('harnessmith-adopt-changed-');
  const changedSource = join(changedFixture.root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(changedSource), { recursive: true });
  writeFileSync(changedSource, '# first\n');
  const changedAdapter = createAdapter('codex', { env: changedFixture.env });
  const proposal = createAdoptPlan([changedAdapter], changedFixture.env).report;
  writeFileSync(changedSource, '# changed after preview\n');
  assert.throws(
    () =>
      applyAdoptPlan([changedAdapter], changedFixture.env, {
        proposal: proposal.proposalId,
        initGlobal: true,
      }),
    /proposal.*changed/i,
  );
  assert.equal(readFileSync(changedSource, 'utf8'), '# changed after preview\n');
});

test('adopt rolls back Host files when post-install initialization fails', () => {
  const { root, env } = fixture('harnessmith-adopt-rollback-');
  const source = join(root, 'codex-home', 'AGENTS.md');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '# original\n');
  const blockedMemory = join(root, 'blocked-memory');
  writeFileSync(blockedMemory, 'not a directory\n');
  const blockedEnv = { ...env, HARNESS_MEMORY_HOME: blockedMemory };
  const proposal = json(execute(root, blockedEnv, ['adopt', '--agent', 'codex', '--json']));

  const result = execute(root, blockedEnv, [
    'adopt',
    '--agent',
    'codex',
    '--proposal',
    proposal.proposalId,
    '--yes',
    '--json',
  ]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(source, 'utf8'), '# original\n');
  assert.equal(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')), false);
  assert.equal(existsSync(join(root, 'personal-harness')), false);
});
