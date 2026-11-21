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
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, '..', '..', 'bin', 'harnessmith.mjs');

function testEnv(root: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    CLAUDE_CONFIG_DIR: join(root, 'claude-home'),
    OPENCODE_CONFIG_DIR: join(root, 'opencode-home'),
    KIMI_CODE_HOME: join(root, 'kimi-home'),
    DSH_HOME: join(root, 'dsh-home'),
    PI_CODING_AGENT_DIR: join(root, 'pi-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
    HARNESS_OWNER: 'package-test',
    ...overrides,
  };
}

function execute(root: string, args: string[]): string {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: testEnv(root),
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function executeResult(root: string, args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: testEnv(root, envOverrides),
  });
}

function backupWithContent(directory: string, prefix: string, expected: string): void {
  const backup = readdirSync(directory).find((name) => name.startsWith(prefix));
  assert.ok(backup, `missing backup ${prefix}`);
  assert.equal(readFileSync(join(directory, backup), 'utf8'), expected);
}

test('installs all adapters, renders instruction files, and preserves legacy user data', {
  timeout: 60_000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const codex = join(root, 'codex-home');
  const claude = join(root, 'claude-home');
  const cursor = join(project, '.cursor');
  mkdirSync(project, { recursive: true });
  const gitInit = spawnSync('git', ['-C', project, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  mkdirSync(join(cursor, 'rules'), { recursive: true });
  mkdirSync(codex, { recursive: true });
  mkdirSync(claude, { recursive: true });
  const legacyHub = join(root, '.agents', 'harnessmith');
  mkdirSync(join(legacyHub, 'skills', 'agent-harness'), { recursive: true });
  mkdirSync(join(legacyHub, 'state'), { recursive: true });
  writeFileSync(join(legacyHub, 'skills', 'agent-harness', 'marker.txt'), 'old harness');
  writeFileSync(join(legacyHub, 'state', 'keep.txt'), 'preserved state');
  writeFileSync(join(codex, 'AGENTS.md'), 'old codex');
  writeFileSync(join(claude, 'AGENTS.md'), 'old claude canonical');
  writeFileSync(join(claude, 'CLAUDE.md'), 'old claude');
  writeFileSync(join(cursor, 'AGENTS.md'), 'old cursor canonical');
  writeFileSync(join(cursor, 'rules', 'agent-harness.mdc'), 'old cursor');

  const output = execute(root, ['--agent', 'all', '--project', project, '--yes', '--force']);
  assert.match(output, /Installed codex/);
  assert.match(output, /Installed cursor/);
  assert.match(output, /Installed claude/);

  const codexRules = readFileSync(join(codex, 'AGENTS.md'), 'utf8');
  const claudeRules = readFileSync(join(claude, 'CLAUDE.md'), 'utf8');
  const cursorRules = readFileSync(join(cursor, 'rules', 'agent-harness.mdc'), 'utf8');
  assert.doesNotMatch(codexRules, /\{\{HARNESS_[A-Z_]+\}\}/);
  assert.ok(codexRules.includes(join(root, 'agent-docs', 'profile.md')));
  assert.match(codexRules, /`harnessmith`/);
  for (const instruction of [
    join(codex, 'AGENTS.md'),
    join(claude, 'AGENTS.md'),
    join(claude, 'CLAUDE.md'),
    join(cursor, 'AGENTS.md'),
    join(cursor, 'rules', 'agent-harness.mdc'),
  ]) {
    assert.equal(lstatSync(instruction).isSymbolicLink(), false, instruction);
  }
  assert.match(claudeRules, /宿主原生 memory 只是待核对线索/);
  assert.match(cursorRules, /^---\ndescription: Personal coding agent harness/m);
  assert.match(cursorRules, /alwaysApply: true/);
  assert.match(cursorRules, /managed-by: harnessmith/);
  assert.ok(existsSync(join(codex, '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(root, 'agent-docs', 'README.md')));
  assert.ok(existsSync(join(root, 'agent-docs', 'profile.md')));
  assert.ok(existsSync(join(root, 'personal-harness', 'AGENTS.md')));
  assert.equal(existsSync(join(root, '.harnessmith', 'dist')), false);
  assert.equal(existsSync(join(root, '.harnessmith', 'scripts')), false);
  assert.equal(existsSync(join(root, '.harnessmith', '.harnessmith', 'install.json')), false);

  const projectStatus = spawnSync('git', ['-C', project, 'status', '--short'], {
    encoding: 'utf8',
  });
  assert.equal(projectStatus.status, 0, projectStatus.stderr);
  assert.equal(projectStatus.stdout, '');

  backupWithContent(codex, 'AGENTS.md.backup-', 'old codex');
  backupWithContent(claude, 'AGENTS.md.backup-', 'old claude canonical');
  backupWithContent(claude, 'CLAUDE.md.backup-', 'old claude');
  backupWithContent(cursor, 'AGENTS.md.backup-', 'old cursor canonical');
  backupWithContent(join(cursor, 'rules'), 'agent-harness.mdc.backup-', 'old cursor');
  assert.equal(
    readFileSync(join(legacyHub, 'skills', 'agent-harness', 'marker.txt'), 'utf8'),
    'old harness',
  );
  assert.equal(readFileSync(join(legacyHub, 'state', 'keep.txt'), 'utf8'), 'preserved state');
  assert.equal(existsSync(join(legacyHub, 'entry')), false);
  assert.equal(existsSync(join(legacyHub, '.harnessmith')), false);

  for (const skill of [
    join(root, '.agents', 'skills', 'agent-harness'),
    join(claude, 'skills', 'agent-harness'),
    join(project, '.agents', 'skills', 'agent-harness'),
  ]) {
    assert.ok(existsSync(join(skill, 'SKILL.md')), skill);
    assert.ok(existsSync(join(skill, 'docs', 'README.md')), skill);
    assert.equal(existsSync(join(skill, 'packages')), false);
    assert.equal(existsSync(join(skill, 'dist')), false);
    assert.equal(existsSync(join(skill, 'scripts')), false);
    assert.equal(existsSync(join(skill, 'install-context.json')), false);
    assert.doesNotMatch(readFileSync(join(skill, 'SKILL.md'), 'utf8'), /\{\{HARNESS_/);
  }

  const version = JSON.parse(execute(root, ['version', '--json']));
  assert.equal(version.harnessVersion, '3.0.0');
  assert.match(execute(root, ['doctor']), /Doctor passed/);
  const validation = JSON.parse(execute(root, ['validate', '--json']));
  assert.equal(validation.valid, true);

  const status = execute(root, ['status', '--agent', 'all', '--project', project]);
  assert.match(status, /"status":"managed"/);
});

test('refuses unmanaged files without force and restores them on uninstall', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-conflict-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const codex = join(root, 'codex-home');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'AGENTS.md'), 'personal rules');

  const refused = executeResult(root, ['--agent', 'codex']);
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /require --force/);
  assert.equal(readFileSync(join(codex, 'AGENTS.md'), 'utf8'), 'personal rules');

  execute(root, ['--agent', 'codex', '--force']);
  assert.match(readFileSync(join(codex, 'AGENTS.md'), 'utf8'), /managed-by: harnessmith/);
  const uninstalled = execute(root, ['uninstall', '--agent', 'codex']);
  assert.match(uninstalled, /Uninstalled codex/);
  assert.equal(readFileSync(join(codex, 'AGENTS.md'), 'utf8'), 'personal rules');
  assert.equal(existsSync(join(root, '.agents', 'skills', 'agent-harness')), false);
  assert.equal(existsSync(join(codex, '.harnessmith', 'install.json')), false);
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);
  assert.equal(existsSync(join(root, '.harnessmith', 'skills')), false);
});

test('requires force when a managed file was modified and restore returns the previous layer', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-restore-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex']);
  const rules = join(root, 'codex-home', 'AGENTS.md');
  const first = readFileSync(rules, 'utf8');
  writeFileSync(rules, `${first}\nuser edit\n`);

  const refused = executeResult(root, ['--agent', 'codex']);
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /require --force/);
  execute(root, ['--agent', 'codex', '--force']);
  execute(root, ['restore', '--agent', 'codex']);
  assert.match(readFileSync(rules, 'utf8'), /user edit/);
});

test('json restore refusal uses the stable safety error contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-restore-json-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex']);
  const rules = join(root, 'codex-home', 'AGENTS.md');
  writeFileSync(rules, `${readFileSync(rules, 'utf8')}\nuser edit\n`);

  const result = executeResult(root, ['restore', '--agent', 'codex', '--json']);

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stderr);
  assert.equal(report.error.code, 'SAFETY_CONFLICT');
  assert.equal(report.error.exitCode, 3);
  assert.match(report.error.message, /modified/);
});

test('rejects a tampered installation record before recovery touches paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-record-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex']);
  const recordPath = join(root, 'codex-home', '.harnessmith', 'install.json');
  const victim = join(root, 'victim.txt');
  writeFileSync(victim, 'keep me');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.outputs[0].path = victim;
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const result = executeResult(root, ['uninstall', '--agent', 'codex', '--force']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /do not match the contract/);
  assert.equal(readFileSync(victim, 'utf8'), 'keep me');
});

test('dry-run reports destinations without creating agent homes', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-dry-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'project'));
  const output = execute(root, ['--agent', 'all', '--project', join(root, 'project'), '--dry-run']);
  for (const adapter of [
    'codex',
    'cursor',
    'claude',
    'opencode',
    'kimi',
    'zed',
    'deepseek',
    'pi',
  ]) {
    assert.match(output, new RegExp(`"adapter":"${adapter}"`));
  }
  assert.match(output, /"action":"create"/);
  assert.equal(existsSync(join(root, 'codex-home')), false);
  assert.equal(existsSync(join(root, 'claude-home')), false);
  assert.equal(existsSync(join(root, 'opencode-home')), false);
  assert.equal(existsSync(join(root, 'project', '.cursor')), false);
});

test('json mode emits parseable automation output without terminal decoration', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-json-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'project'));
  const preview = execute(root, [
    'install',
    '--agent',
    'all',
    '--project',
    join(root, 'project'),
    '--dry-run',
    '--json',
  ]);
  const plans = preview
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    plans.map(({ adapter }) => adapter),
    ['codex', 'cursor', 'claude', 'opencode', 'kimi', 'zed', 'deepseek', 'pi'],
  );
  assert.equal(plans[0].capabilities.scope, 'global');
  assert.equal(plans[1].capabilities.scope, 'project');
  assert.equal(plans[1].capabilities.nativeRuleActivation, 'always');
  assert.equal(plans[1].capabilities.enforcement.instructions, 'advisory');
  assert.equal(plans[1].capabilities.enforcement.permissions, 'host-owned');
  assert.doesNotMatch(preview, /[◆●│]/);

  const installed = execute(root, ['install', '--agent', 'codex', '--no-init-global', '--json']);
  const result = JSON.parse(installed);
  assert.equal(result.command, 'install');
  assert.equal(result.results[0].adapter, 'codex');
  assert.equal(result.results[0].initializeGlobalMemory, false);
});

test('json mode emits a structured safety error and a distinct exit code', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-json-error-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const codex = join(root, 'codex-home');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'AGENTS.md'), 'unmanaged rules');

  const result = executeResult(root, ['install', '--agent', 'codex', '--json']);

  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  const report = JSON.parse(result.stderr);
  assert.equal(report.version, 1);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, 'SAFETY_CONFLICT');
  assert.equal(report.error.exitCode, 3);
  assert.match(report.error.message, /require --force/);
});

test('json mode converts Commander usage failures into one structured error', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-json-usage-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  const result = executeResult(root, ['install', '--agent', 'codex', '--unknown', '--json']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trim().split('\n');
  assert.equal(lines.length, 1);
  const report = JSON.parse(elementAt(lines, 0));
  assert.equal(report.error.code, 'CLI_USAGE');
  assert.equal(report.error.exitCode, 2);
});

test('json mode never prompts when the target agent is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-json-agent-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  const result = executeResult(root, ['install', '--dry-run', '--json']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  const report = JSON.parse(result.stderr);
  assert.equal(report.error.code, 'CLI_USAGE');
  assert.match(report.error.message, /agent/i);
});

test('no-init-global installs files without creating shared memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-no-init-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex', '--no-init-global']);
  const skill = join(root, '.agents', 'skills', 'agent-harness');
  assert.ok(existsSync(join(skill, 'SKILL.md')));
  assert.equal(existsSync(join(skill, 'scripts')), false);
  assert.equal(existsSync(join(skill, 'dist')), false);
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);
  assert.equal(existsSync(join(root, 'agent-docs')), false);
  assert.ok(existsSync(join(root, 'personal-harness', 'AGENTS.md')));
});

test('global-memory initialization failure rolls back installed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-init-failure-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const codex = join(root, 'codex-home');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'AGENTS.md'), 'original rules');
  writeFileSync(join(root, 'agent-docs'), 'path blocker');

  const result = executeResult(root, ['--agent', 'codex', '--force']);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(codex, 'AGENTS.md'), 'utf8'), 'original rules');
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);
  assert.equal(existsSync(join(root, '.harnessmith', 'skills')), false);
  assert.equal(existsSync(join(root, '.agents', 'skills', 'agent-harness')), false);
  assert.equal(readFileSync(join(root, 'agent-docs'), 'utf8'), 'path blocker');
});

test('mutable Harness state stays managed across status and upgrade', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-state-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex']);
  const state = join(root, '.harnessmith', 'state');
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'runtime.json'), '{"checkpoint":1}\n');

  const status = execute(root, ['status', '--agent', 'codex']);
  assert.match(status, /"status":"managed"/);
  execute(root, ['--agent', 'codex']);
  assert.equal(readFileSync(join(state, 'runtime.json'), 'utf8'), '{"checkpoint":1}\n');
});

test('multi-Agent uninstall preflights every target before changing any target', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lifecycle-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex,claude']);
  const codexRules = join(root, 'codex-home', 'AGENTS.md');
  const claudeRules = join(root, 'claude-home', 'CLAUDE.md');
  writeFileSync(claudeRules, `${readFileSync(claudeRules, 'utf8')}\nuser edit\n`);

  const result = executeResult(root, ['uninstall', '--agent', 'codex,claude']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /modified/);
  assert.ok(existsSync(codexRules));
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(root, 'claude-home', '.harnessmith', 'install.json')));
});

test('overlapping Agent homes are rejected before creating files', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-overlap-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, 'shared-home');
  const result = executeResult(root, ['--agent', 'codex,claude', '--dry-run'], {
    CODEX_HOME: shared,
    CLAUDE_CONFIG_DIR: shared,
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /destinations overlap/);
  assert.equal(existsSync(shared), false);
});

test('rejects a symlinked Cursor rules directory before writing outside the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-symlink-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const cursor = join(project, '.cursor');
  const outside = join(root, 'outside');
  mkdirSync(cursor, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const gitInit = spawnSync('git', ['-C', project, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  symlinkSync(outside, join(cursor, 'rules'), 'dir');

  const result = executeResult(root, [
    'install',
    '--agent',
    'cursor',
    '--project',
    project,
    '--no-init-global',
  ]);

  assert.equal(result.status, 3);
  assert.match(result.stderr, /symlink|symbolic link/i);
  assert.equal(existsSync(join(outside, 'agent-harness.mdc')), false);
  assert.equal(existsSync(join(cursor, 'skills', 'agent-harness')), false);
  assert.equal(existsSync(join(cursor, '.harnessmith', 'install.json')), false);
});

test('uninstall preserves customized personal overlay', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-personal-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex']);
  const personalRules = join(root, 'personal-harness', 'AGENTS.md');
  writeFileSync(personalRules, `${readFileSync(personalRules, 'utf8')}\ncustom rule\n`);
  execute(root, ['uninstall', '--agent', 'codex']);
  assert.match(readFileSync(personalRules, 'utf8'), /custom rule/);
});
