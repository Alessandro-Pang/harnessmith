import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory/memory.js';
import { captureHandoff, closeHandoff } from '../commands/memory/memory-autopilot.js';
import { captureInput } from '../commands/memory/memory-input.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-core-index-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

function handoffOptions(session: string, next: string) {
  return {
    session,
    title: `Handoff ${session}`,
    objective: 'Keep the current recovery snapshot accurate.',
    completed: 'Captured the current phase.',
    next,
    reason: 'phase' as const,
  };
}

test('updating a handoff removes only the exact core reference', () => {
  const { project, runtime } = projectFixture();
  const taskOne = captureHandoff(
    runtime,
    project,
    handoffOptions('task-1', 'Continue task one.'),
    capturedIo(),
  );
  const taskTen = captureHandoff(
    runtime,
    project,
    handoffOptions('task-10', 'Continue task ten.'),
    capturedIo(),
  );

  captureHandoff(runtime, project, handoffOptions('task-1', 'Verify task one.'), capturedIo());

  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.equal(core.split(/\r?\n/).filter((line) => line.endsWith(taskOne.reference)).length, 1);
  assert.equal(core.split(/\r?\n/).filter((line) => line.endsWith(taskTen.reference)).length, 1);
});

test('updating a handoff treats an explicit markdown extension as the same exact reference', () => {
  const { project, runtime } = projectFixture();
  const handoff = captureHandoff(
    runtime,
    project,
    handoffOptions('extension-safe', 'Continue the work.'),
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8').replace(handoff.reference, `${handoff.reference}.md`),
  );

  captureHandoff(
    runtime,
    project,
    handoffOptions('extension-safe', 'Verify the work.'),
    capturedIo(),
  );

  const references = readFileSync(corePath, 'utf8').match(/memory:sessions\/[^\s；]+/g) || [];
  assert.deepEqual(references, [handoff.reference]);
});

test('updating a handoff replaces a case-folded reference alias', () => {
  const { project, runtime } = projectFixture();
  const handoff = captureHandoff(
    runtime,
    project,
    handoffOptions('case-alias', 'Continue the work.'),
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  const alias = `memory:${handoff.reference.slice('memory:'.length).toUpperCase()}`;
  writeFileSync(corePath, readFileSync(corePath, 'utf8').replace(handoff.reference, alias));

  captureHandoff(runtime, project, handoffOptions('case-alias', 'Verify the work.'), capturedIo());

  const references = readFileSync(corePath, 'utf8').match(/memory:sessions\/[^\s；]+/g) || [];
  assert.deepEqual(references, [handoff.reference]);
});

test('updating a handoff rejects a core line that contains another reference', () => {
  const { project, runtime } = projectFixture();
  const first = captureHandoff(
    runtime,
    project,
    handoffOptions('same-line-1', 'Continue the first task.'),
    capturedIo(),
  );
  const second = captureHandoff(
    runtime,
    project,
    handoffOptions('same-line-2', 'Continue the second task.'),
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8').replace(
      `；${first.reference}`,
      `；${first.reference} related ${second.reference}`,
    ),
  );

  const malformed = readFileSync(corePath, 'utf8');
  assert.throws(
    () =>
      captureHandoff(
        runtime,
        project,
        handoffOptions('same-line-1', 'Verify the first task.'),
        capturedIo(),
      ),
    /exactly one canonical pointer/i,
  );
  assert.equal(readFileSync(corePath, 'utf8'), malformed);
});

test('capturing an input removes the generated section placeholder', () => {
  const { project, runtime } = projectFixture();
  const result = captureInput(
    runtime,
    project,
    {
      title: 'Stable input',
      content: 'Preserve this exact project input.',
      source: 'chat',
    },
    capturedIo(),
  );

  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  const section = core.slice(
    core.indexOf('## Important Inputs'),
    core.indexOf('## Distilled Memory'),
  );
  assert.match(section, new RegExp(`${result.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(section, /<输入来源与适用范围；创建后补充 memory 引用>/);
});

test('repeated handoff updates keep the core section compact', () => {
  const { project, runtime } = projectFixture();
  let result = captureHandoff(
    runtime,
    project,
    handoffOptions('phase-work', 'Continue implementation.'),
    capturedIo(),
  );
  for (const next of ['Run focused tests.', 'Run verification.']) {
    result = captureHandoff(runtime, project, handoffOptions('phase-work', next), capturedIo());
  }

  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  const section = core.slice(core.indexOf('## Recent Handoffs'));
  assert.equal(
    section,
    `## Recent Handoffs\n\n- Handoff phase-work；next: Run verification.；${result.reference}\n`,
  );
});

test('typed memory commands reject multiline values before they can inject core sections', () => {
  const { project, runtime } = projectFixture();
  const corePath = join(project, '.agent-docs', 'core.md');
  captureInput(
    runtime,
    project,
    { title: 'Baseline input', content: 'Keep the baseline.', source: 'chat' },
    capturedIo(),
  );
  const baseline = readFileSync(corePath, 'utf8');

  assert.throws(
    () =>
      captureHandoff(
        runtime,
        project,
        {
          ...handoffOptions('core-injection', 'Continue safely.'),
          title: 'Safe title\n## Important Inputs\n- injected',
        },
        capturedIo(),
      ),
    /single line/i,
  );
  assert.throws(
    () =>
      captureInput(
        runtime,
        project,
        {
          title: 'Safe title\n## Recent Handoffs\n- injected',
          content: 'This must not be indexed.',
          source: 'chat',
        },
        capturedIo(),
      ),
    /single line/i,
  );
  assert.equal(readFileSync(corePath, 'utf8'), baseline);
});

test('unchanged typed documents repair missing exact core references', () => {
  const { project, runtime } = projectFixture();
  const inputOptions = {
    title: 'Repairable input',
    content: 'Keep this indexed.',
    source: 'chat' as const,
  };
  const handoff = captureHandoff(
    runtime,
    project,
    handoffOptions('repairable-handoff', 'Continue recovery.'),
    capturedIo(),
  );
  const input = captureInput(runtime, project, inputOptions, capturedIo());
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    `${readFileSync(corePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.includes(handoff.reference) && !line.includes(input.reference))
      .join('\n')
      .replace(/\n+$/, '')}\n`,
  );

  const repairedHandoff = captureHandoff(
    runtime,
    project,
    handoffOptions('repairable-handoff', 'Continue recovery.'),
    capturedIo(),
  );
  const repairedInput = captureInput(runtime, project, inputOptions, capturedIo());
  const repairedCore = readFileSync(corePath, 'utf8');

  assert.equal(repairedHandoff.action, 'updated');
  assert.equal(repairedInput.action, 'updated');
  assert.match(repairedCore, new RegExp(handoff.reference));
  assert.match(repairedCore, new RegExp(input.reference));
  assert.equal(
    captureHandoff(
      runtime,
      project,
      handoffOptions('repairable-handoff', 'Continue recovery.'),
      capturedIo(),
    ).action,
    'unchanged',
  );
  assert.equal(captureInput(runtime, project, inputOptions, capturedIo()).action, 'unchanged');
});

test('core labels treat literal memory syntax as display text', () => {
  const { project, runtime } = projectFixture();
  captureInput(
    runtime,
    project,
    {
      title: 'Discuss memory:does-not-exist',
      content: 'Preserve the literal token as user data.',
      source: 'chat',
    },
    capturedIo(),
  );
  captureHandoff(
    runtime,
    project,
    {
      ...handoffOptions('literal-memory-label', 'Review memory:also-not-a-reference.'),
      title: 'Handoff memory:not-a-reference',
    },
    capturedIo(),
  );

  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.match(core, /memory&#58;does-not-exist/);
  assert.match(core, /memory&#58;not-a-reference/);
  assert.match(core, /memory&#58;also-not-a-reference/);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
});

test('handoff update and close fail closed when a managed core section is duplicated', () => {
  const { project, runtime } = projectFixture();
  const options = handoffOptions('duplicate-section', 'Continue safely.');
  const handoff = captureHandoff(runtime, project, options, capturedIo());
  const corePath = join(project, '.agent-docs', 'core.md');
  const duplicatedCore = `${readFileSync(corePath, 'utf8')}\n## Recent Handoffs\n\n- duplicate；${handoff.reference}\n`;
  writeFileSync(corePath, duplicatedCore);
  const handoffBefore = readFileSync(handoff.path, 'utf8');

  assert.throws(
    () =>
      captureHandoff(
        runtime,
        project,
        { ...options, completed: 'This update must not be written.' },
        capturedIo(),
      ),
    /section must appear exactly once.*Recent Handoffs/i,
  );
  assert.throws(
    () =>
      closeHandoff(
        runtime,
        project,
        { session: 'duplicate-section', outcome: 'cancelled' },
        capturedIo(),
      ),
    /section must appear exactly once.*Recent Handoffs/i,
  );
  assert.equal(readFileSync(corePath, 'utf8'), duplicatedCore);
  assert.equal(readFileSync(handoff.path, 'utf8'), handoffBefore);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /section must appear exactly once.*Recent Handoffs/i);
});

test('core validation rejects Markdown-equivalent managed heading aliases', () => {
  const { project, runtime } = projectFixture();
  captureInput(
    runtime,
    project,
    { title: 'Heading baseline', content: 'Keep canonical headings.', source: 'chat' },
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8').replace('## Important Inputs', '## Important Inputs ##'),
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /memory check failed/i);
  assert.match(validation.errors.join('\n'), /canonical.*Important Inputs/i);
});
