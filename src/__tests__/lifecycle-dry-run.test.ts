import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function execute(root: string, args: string[]): string {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      CODEX_HOME: join(root, 'codex-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'lifecycle-dry-run-test',
    },
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

for (const command of ['restore', 'uninstall'] as const) {
  test(`${command} dry-run previews every lifecycle change without modifying the installation`, () => {
    const root = mkdtempSync(join(tmpdir(), `harnessmith-${command}-dry-`));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    execute(root, ['install', '--agent', 'codex']);
    execute(root, ['install', '--agent', 'codex']);
    const rules = join(root, 'codex-home', 'AGENTS.md');
    const record = join(root, 'codex-home', '.harnessmith', 'install.json');
    const rulesBefore = readFileSync(rules, 'utf8');
    const recordBefore = readFileSync(record, 'utf8');
    const canonicalRules = realpathSync.native(rules);

    const output = execute(root, [command, '--agent', 'codex', '--dry-run', '--json']);

    assert.ok(existsSync(record), `${command} dry-run removed the installation record`);
    assert.equal(readFileSync(record, 'utf8'), recordBefore);
    assert.equal(readFileSync(rules, 'utf8'), rulesBefore);
    const plan = JSON.parse(output);
    assert.equal(plan.command, command);
    assert.equal(plan.adapter, 'codex');
    assert.deepEqual(plan.capabilities, {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: {
        fileOwnership: 'harnessmith',
        instructions: 'advisory',
        permissions: 'host-owned',
      },
    });
    assert.equal(plan.layers.length, command === 'restore' ? 1 : 2);
    assert.ok(
      plan.layers.every((layer: { changes: Array<{ path: string }> }) =>
        layer.changes.some(
          ({ path }) => existsSync(path) && realpathSync.native(path) === canonicalRules,
        ),
      ),
    );
  });
}
