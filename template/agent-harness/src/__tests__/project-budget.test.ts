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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { closeTask, initTask } from '../commands/task/task.js';
import { classifyGitFailure, gitRoot, gitVersion } from '../lib/filesystem/git.js';
import { projectSnapshot } from '../lib/project/project.js';
import { createProjectGitBudget, projectGitRaw } from '../lib/project/project-git.js';
import { resolveGitExecutable } from '../lib/filesystem/run-git.js';
import { projectRoot } from '../lib/task/task-store.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function gitExecutable(bin: string, source: string, mode = 0o755): void {
  const executable = join(bin, process.platform === 'win32' ? 'git.cmd' : 'git');
  if (process.platform === 'win32') {
    const script = join(bin, 'git.mjs');
    writeFileSync(script, `${source}\n`);
    writeFileSync(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    writeFileSync(executable, `#!${process.execPath}\n${source}\n`);
  }
  chmodSync(executable, mode);
}

function fakeGit(project: string, delayMs = 0): { bin: string; log: string } {
  const bin = join(project, 'fake-bin');
  const log = join(project, 'fake-git.log');
  mkdirSync(bin);
  gitExecutable(
    bin,
    `
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
  return { bin, log };
}

function withGitPath<T>(bin: string, operation: () => T, exact = false): T {
  const original = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  process.env.PATH = exact ? bin : `${bin}${delimiter}${original || ''}`;
  if (process.platform === 'win32') {
    process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD', originalPathExt || ''].join(delimiter);
  }
  try {
    return operation();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
  }
}

function withGitRepositoryEnvironment<T>(
  values: Partial<Record<'GIT_DIR' | 'GIT_WORK_TREE', string>>,
  operation: () => T,
): T {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Harness Git resolution uses a trusted resolver cwd instead of the project cwd', () => {
  const resolved = resolveGitExecutable('win32', (command, options) => {
    assert.equal(command, 'git');
    assert.equal(options.cwd, dirname(process.execPath));
    return String.raw`C:\Program Files\Git\cmd\git.exe`;
  });

  assert.equal(resolved, String.raw`C:\Program Files\Git\cmd\git.exe`);
});

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
  assert.equal(
    classifyGitFailure({
      exitCode: 1,
      failed: true,
      isMaxBuffer: false,
      stderr: Buffer.from(
        "'git' is not recognized as an internal or external command,\r\noperable program or batch file.",
      ),
      timedOut: false,
    }),
    'failed',
  );

  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-errors-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  gitExecutable(bin, "process.stderr.write('fatal: not a git repository\\n');\nprocess.exit(128);");

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

test.skipIf(process.platform === 'win32')(
  'project Git fails closed when the executable is not permitted',
  () => {
    const project = mkdtempSync(join(tmpdir(), 'harness-project-git-permission-'));
    onTestFinished(() => rmSync(project, { recursive: true, force: true }));
    const bin = join(project, 'bin');
    mkdirSync(bin);
    gitExecutable(bin, 'process.exit(0);', 0o644);

    assert.throws(
      () =>
        withGitPath(
          bin,
          () =>
            projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
          true,
        ),
      /Git executable permission denied/i,
    );
  },
);

test('project Git fails closed when Git reports permission denial', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-permission-message-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  gitExecutable(bin, "process.stderr.write('fatal: permission denied\\n');\nprocess.exit(128);");

  assert.throws(
    () =>
      withGitPath(
        bin,
        () => projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
        true,
      ),
    /Git permission denied/i,
  );
});

test.runIf(process.platform === 'win32')(
  'project Git does not execute a command shim from the process working directory',
  () => {
    const project = mkdtempSync(join(tmpdir(), 'harness-project-git-cwd-'));
    onTestFinished(() => rmSync(project, { recursive: true, force: true }));
    const marker = join(project, 'git-command-hijacked');
    gitExecutable(
      project,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'called\\n');
process.stderr.write('fatal: not a git repository\\n');
process.exit(128);`,
    );
    const original = process.cwd();
    process.chdir(project);
    try {
      assert.equal(
        projectGitRaw(project, ['rev-parse', '--show-toplevel'], createProjectGitBudget({})),
        null,
      );
    } finally {
      process.chdir(original);
    }
    assert.equal(existsSync(marker), false);
  },
);

test('project Git preserves raw NUL-delimited output', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-project-git-raw-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const bin = join(project, 'bin');
  mkdirSync(bin);
  gitExecutable(bin, "process.stdout.write(Buffer.from(' M tracked.txt\\0?? untracked.txt\\0'));");

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
    realpathSync.native(project),
  );
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

test('task project root canonicalizes filesystem aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-project-root-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const alias = join(root, 'project-alias');
  mkdirSync(project);
  symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(projectRoot(alias), realpathSync.native(project));
});

test('task project root ignores ambient Git repository redirection', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-project-git-env-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const requested = join(root, 'requested');
  const redirected = join(root, 'redirected');
  mkdirSync(requested);
  mkdirSync(redirected);
  execFileSync('git', ['init', redirected], { stdio: 'ignore' });

  const resolved = withGitRepositoryEnvironment(
    { GIT_DIR: join(redirected, '.git'), GIT_WORK_TREE: redirected },
    () => projectRoot(requested),
  );

  assert.equal(resolved, realpathSync.native(requested));
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
