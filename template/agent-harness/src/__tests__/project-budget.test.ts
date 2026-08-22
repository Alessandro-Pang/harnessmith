import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { closeTask, initTask } from '../commands/task.js';
import { gitRoot, gitVersion } from '../lib/git.js';
import { projectSnapshot } from '../lib/project.js';
import { createProjectGitBudget, projectGitRaw } from '../lib/project-git.js';
import { projectRoot } from '../lib/task-store.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fakeGit(project: string, delayMs = 0): { bin: string; log: string } {
  const bin = join(project, 'fake-bin');
  const log = join(project, 'fake-git.log');
  mkdirSync(bin);
  const executable = join(bin, 'git');
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
  process.stdout.write(${JSON.stringify(`${realpathSync(project)}\n`)});
} else if (args.includes('rev-parse') && args.includes('HEAD')) {
  process.stdout.write('0123456789ab\\n');
} else if (args.includes('branch')) {
  process.stdout.write('main\\n');
} else if (${delayMs} > 0) {
  setTimeout(() => process.exit(0), ${delayMs});
}
`,
  );
  chmodSync(executable, 0o755);
  return { bin, log };
}

function withGitPath<T>(bin: string, operation: () => T, exact = false): T {
  const original = process.env.PATH;
  process.env.PATH = exact ? bin : `${bin}${delimiter}${original || ''}`;
  try {
    return operation();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

test('project snapshot applies one finite deadline to Git probes and fails closed on timeout', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-budget-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const { bin } = fakeGit(project, 1_000);

  const startedAt = Date.now();
  assert.throws(
    () => withGitPath(bin, () => projectSnapshot(project, { gitTimeoutMs: 50 })),
    /Git command timed out/i,
  );

  assert.equal(Date.now() - startedAt < 500, true);
});

test('project Git budgets reject invalid limits and fail closed once exhausted', () => {
  assert.throws(() => createProjectGitBudget({ gitTimeoutMs: 0 }), /Invalid Git timeout/);

  const budget = { deadline: Date.now() - 1, exhausted: false };
  assert.throws(() => projectGitRaw(process.cwd(), ['status'], budget), /Git command timed out/i);
  assert.equal(budget.exhausted, true);
});

test('project Git distinguishes a non-repository from an unavailable executable', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-errors-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'git');
  writeFileSync(executable, "#!/bin/sh\necho 'fatal: not a git repository' >&2\nexit 128\n");
  chmodSync(executable, 0o755);

  const nonRepository = withGitPath(bin, () =>
    projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
  );
  assert.equal(nonRepository, null);

  const emptyPath = join(project, 'empty-path');
  mkdirSync(emptyPath);
  assert.throws(
    () =>
      withGitPath(
        emptyPath,
        () => projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
        true,
      ),
    /Git executable is unavailable/i,
  );
  assert.throws(
    () => withGitPath(emptyPath, () => gitRoot(project), true),
    /Git executable is unavailable/i,
  );
  assert.equal(
    withGitPath(emptyPath, () => gitVersion(), true),
    null,
  );
});

test('project Git fails closed when the executable is not permitted', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-permission-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'git');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n');
  chmodSync(executable, 0o644);

  assert.throws(
    () =>
      withGitPath(
        bin,
        () => projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
        true,
      ),
    /Git executable permission denied/i,
  );
});

test('project Git preserves raw NUL-delimited output', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-raw-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'git');
  writeFileSync(executable, "#!/bin/sh\nprintf ' M tracked.txt\\000?? untracked.txt\\000'\n");
  chmodSync(executable, 0o755);

  const output = withGitPath(bin, () =>
    projectGitRaw(project, ['status', '--porcelain=v1', '-z'], createProjectGitBudget({})),
  );

  assert.deepEqual(output, Buffer.from(' M tracked.txt\0?? untracked.txt\0'));
});

test('task project root discovery does not compute a full project snapshot', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-root-budget-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const { bin, log } = fakeGit(project);

  assert.equal(
    withGitPath(bin, () => projectRoot(project)),
    realpathSync(project),
  );
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

test('project Git probes disable repository-controlled fsmonitor hooks', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-safe-git-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  execFileSync('git', ['-C', project, 'init', '-q']);
  const marker = join(project, 'fsmonitor-called');
  const hook = join(project, 'mark-fsmonitor.mjs');
  writeFileSync(
    hook,
    `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'called\\n');\n`,
  );
  chmodSync(hook, 0o755);
  execFileSync('git', ['-C', project, 'config', 'core.fsmonitor', hook]);

  assert.match(projectSnapshot(project).workspaceDigest || '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(existsSync(marker), false);
});

test('blocked close reuses one snapshot while holding the task lock', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-close-snapshot-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  execFileSync('git', ['-C', project, 'init', '-q']);
  initTask(
    harnessRuntime(project),
    { project, id: 'blocked-budget', objective: 'Wait safely', acceptance: ['Access arrives'] },
    capturedIo(),
  );
  const { bin, log } = fakeGit(project);

  withGitPath(bin, () =>
    closeTask(
      {
        project,
        id: 'blocked-budget',
        summary: 'Waiting for access',
        status: 'blocked',
        nextAction: 'Obtain access',
      },
      capturedIo(),
    ),
  );

  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 7);
});
