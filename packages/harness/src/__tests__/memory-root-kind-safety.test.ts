import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryMigrate } from '../commands/memory/memory-migration.js';
import { createHealthReport } from '../lib/health/health.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-root-kind-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

test('health rejects exact opposite core layouts in known global and project roots', () => {
  const { project, runtime } = fixture();
  initGlobal(runtime, capturedIo());
  initProject(runtime, project, capturedIo());
  const globalCore = join(runtime.memoryHome, 'core.md');
  const projectCore = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    globalCore,
    `${readFileSync(globalCore, 'utf8').replace(
      '## User Profile',
      '## Important Inputs',
    )}\n## Recent Handoffs\n\n- exact project shape\n`,
  );
  writeFileSync(
    projectCore,
    readFileSync(projectCore, 'utf8')
      .replace('## Important Inputs', '## User Profile')
      .replace('## Recent Handoffs', '## Former Handoffs'),
  );

  const report = createHealthReport(runtime, project);
  for (const id of ['global-memory', 'project-memory']) {
    const check = report.checks.find((candidate) => candidate.id === id);
    assert.equal(check?.status, 'failed', id);
    assert.match(check?.details?.join('\n') ?? '', /managed section layout/i, id);
  }
});

test('migration rejects a global user profile copied into project memory', () => {
  const { project, runtime } = fixture();
  initGlobal(runtime, capturedIo());
  initProject(runtime, project, capturedIo());
  const projectMemory = join(project, '.agent-docs');
  const projectCore = join(projectMemory, 'core.md');
  writeFileSync(
    join(projectMemory, 'profile.md'),
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
  );
  writeFileSync(
    projectCore,
    `${readFileSync(projectCore, 'utf8')}\n- copied global profile memory:profile\n`,
  );

  const report = memoryMigrate(runtime, project, 'profile', '{}', {}, capturedIo());

  assert.equal(report.ready, false);
  assert.equal(
    report.issues.some((issue) => /user profile is permitted only in global memory/i.test(issue)),
    true,
  );
});

test('initialization rolls back opposite core layouts and project ignore edits', () => {
  const { project, runtime } = fixture();
  initGlobal(runtime, capturedIo());
  initProject(runtime, project, capturedIo());
  const globalCore = join(runtime.memoryHome, 'core.md');
  const projectCore = join(project, '.agent-docs', 'core.md');
  const wrongGlobal = `${readFileSync(globalCore, 'utf8').replace(
    '## User Profile',
    '## Important Inputs',
  )}\n## Recent Handoffs\n\n- exact project shape\n`;
  const wrongProject = readFileSync(projectCore, 'utf8')
    .replace('## Important Inputs', '## User Profile')
    .replace('## Recent Handoffs', '## Former Handoffs');
  writeFileSync(globalCore, wrongGlobal);
  writeFileSync(projectCore, wrongProject);
  const gitignore = join(project, '.gitignore');
  const ignore = join(project, '.ignore');
  writeFileSync(gitignore, 'baseline git ignore\n');
  writeFileSync(ignore, 'baseline search ignore\n');

  assert.throws(() => initGlobal(runtime, capturedIo()), /memory preflight failed/i);
  assert.equal(readFileSync(globalCore, 'utf8'), wrongGlobal);
  assert.throws(() => initProject(runtime, project, capturedIo()), /memory preflight failed/i);
  assert.equal(readFileSync(projectCore, 'utf8'), wrongProject);
  assert.equal(readFileSync(gitignore, 'utf8'), 'baseline git ignore\n');
  assert.equal(readFileSync(ignore, 'utf8'), 'baseline search ignore\n');
});

test('known root kinds require every canonical managed core section exactly once', () => {
  const { project, runtime } = fixture();
  initGlobal(runtime, capturedIo());
  initProject(runtime, project, capturedIo());
  const globalCore = join(runtime.memoryHome, 'core.md');
  const projectCore = join(project, '.agent-docs', 'core.md');
  const originalGlobalCore = readFileSync(globalCore, 'utf8');
  const originalProjectCore = readFileSync(projectCore, 'utf8');

  writeFileSync(
    projectCore,
    originalProjectCore.replace(
      '## Active Work\n\n- <何时读取、能回答什么；创建后补充 memory 引用>\n\n',
      '',
    ),
  );
  let projectReport = createHealthReport(runtime, project);
  const missingActive = projectReport.checks.find((candidate) => candidate.id === 'project-memory');
  assert.equal(missingActive?.status, 'failed');
  assert.match(missingActive?.details?.join('\n') ?? '', /managed section layout/i);

  writeFileSync(projectCore, originalProjectCore);
  writeFileSync(projectCore, `${originalProjectCore}\n## Distilled Memory\n\n- duplicate\n`);
  projectReport = createHealthReport(runtime, project);
  const duplicateDistilled = projectReport.checks.find(
    (candidate) => candidate.id === 'project-memory',
  );
  assert.equal(duplicateDistilled?.status, 'failed');
  assert.match(
    duplicateDistilled?.details?.join('\n') ?? '',
    /section must appear exactly once.*Distilled Memory/i,
  );

  writeFileSync(globalCore, `${originalGlobalCore}\n## Active Work\n\n- invalid global section\n`);
  const globalReport = createHealthReport(runtime, project);
  const extraActive = globalReport.checks.find((candidate) => candidate.id === 'global-memory');
  assert.equal(extraActive?.status, 'failed');
  assert.match(extraActive?.details?.join('\n') ?? '', /managed section layout/i);
});

test('reserved root documents keep their canonical identity and active lifecycle', () => {
  const { project, runtime } = fixture();
  initGlobal(runtime, capturedIo());
  initProject(runtime, project, capturedIo());
  const cases = [
    {
      path: join(project, '.agent-docs', 'README.md'),
      check: 'project-memory',
      mutate: (content: string) =>
        content.replace('type: agent-memory-index', 'type: project-note'),
    },
    {
      path: join(project, '.agent-docs', 'core.md'),
      check: 'project-memory',
      mutate: (content: string) => content.replace('status: active', 'status: complete'),
    },
    {
      path: join(runtime.memoryHome, 'profile.md'),
      check: 'global-memory',
      mutate: (content: string) => content.replace('status: active', 'status: blocked'),
    },
  ];

  for (const entry of cases) {
    const original = readFileSync(entry.path, 'utf8');
    writeFileSync(entry.path, entry.mutate(original));
    const check = createHealthReport(runtime, project).checks.find(
      (candidate) => candidate.id === entry.check,
    );
    assert.equal(check?.status, 'failed', entry.path);
    assert.match(check?.details?.join('\n') ?? '', /reserved memory document/i, entry.path);
    writeFileSync(entry.path, original);
  }
});
