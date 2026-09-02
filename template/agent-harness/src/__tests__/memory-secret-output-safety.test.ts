import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initProject } from '../commands/init.js';
import { memoryCheck, memoryList, memorySearch } from '../commands/memory/memory.js';
import { captureHandoff, closeHandoff } from '../commands/memory/memory-autopilot.js';
import { captureInput } from '../commands/memory/memory-input.js';
import { archiveMemory } from '../commands/memory/memory-lifecycle.js';
import { memoryMaintenance } from '../commands/memory/memory-maintenance.js';
import {
  reconcileProfile,
  removeProfileEntry,
  setProfileAutopilot,
} from '../commands/memory/memory-profile.js';
import { checkpointTask, closeTask, initTask, taskStatus } from '../commands/task/task.js';
import { updateAcceptance } from '../commands/task/task-acceptance.js';
import { verifyAcceptance } from '../commands/task/task-verification.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-secret-output-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

function memoryDocument(title: string): string {
  return `---
title: ${title}
description: ${title} memory
type: session-handoff
memory-kind: episode
status: active
owners: [test-owner]
created: 2026-08-19
updated: 2026-08-19
project: test
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---
`;
}

function expectNoSecretDiagnostic(
  operation: (io: ReturnType<typeof capturedIo>) => unknown,
  secret: string,
): void {
  const io = capturedIo();
  let caught: unknown;
  try {
    operation(io);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /memory (?:check|preflight) failed|secret material/i);
  const pattern = new RegExp(secret);
  assert.doesNotMatch(caught.message, pattern);
  assert.doesNotMatch([...io.logs, ...io.errors].join('\n'), pattern);
}

test('non-canonical Markdown extensions cannot bypass validation or leak through search', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const secret = `ghp_${'A'.repeat(24)}`;
  writeFileSync(join(project, '.agent-docs', 'LEAK.MD'), `# Search bypass\n\n${secret}\n`);

  expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
  expectNoSecretDiagnostic((io) => memorySearch(runtime, project, secret, io), secret);
});

test('list and maintenance validate before serializing secret-bearing titles', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const secret = `ghp_${'B'.repeat(24)}`;
  const memoryRoot = join(project, '.agent-docs');
  writeFileSync(join(memoryRoot, 'leak-a.md'), memoryDocument(secret));
  writeFileSync(join(memoryRoot, 'leak-b.md'), memoryDocument(secret));

  expectNoSecretDiagnostic((io) => memoryList(runtime, project, io), secret);
  expectNoSecretDiagnostic((io) => memoryMaintenance(runtime, project, {}, io), secret);
});

test('secret-bearing managed paths stay redacted across content and entry failures', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const secret = `ghp_${'C'.repeat(24)}`;
  const memoryRoot = join(project, '.agent-docs');
  const path = join(memoryRoot, `${secret}.md`);
  writeFileSync(path, memoryDocument('Clean path body'));

  for (const operation of [
    (io: ReturnType<typeof capturedIo>) => memoryList(runtime, project, io),
    (io: ReturnType<typeof capturedIo>) => memorySearch(runtime, project, 'Clean path body', io),
    (io: ReturnType<typeof capturedIo>) => memoryMaintenance(runtime, project, {}, io),
  ]) {
    expectNoSecretDiagnostic(operation, secret);
  }

  writeFileSync(path, `invalid frontmatter ${secret}\n`);
  expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
  rmSync(path);
  const target = join(memoryRoot, 'safe-target.md');
  writeFileSync(target, memoryDocument('Safe target'));
  symlinkSync(target, path, 'file');
  expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
  rmSync(path);
  writeFileSync(join(memoryRoot, `${secret}.txt`), `Bearer ${'D'.repeat(24)}\n`);
  expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
});

test('malformed frontmatter diagnostics redact secrets even on a safe filename', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const secret = `ghp_${'E'.repeat(24)}`;
  writeFileSync(join(project, '.agent-docs', 'malformed.md'), `---\ntitle: [${secret}\n---\n`);

  expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
});

test('secret scan budget failures never expose a secret-bearing path', () => {
  const oversized = fixture();
  initProject(oversized.runtime, oversized.project, capturedIo());
  const oversizedSecret = `ghp_${'H'.repeat(24)}`;
  writeFileSync(
    join(oversized.project, '.agent-docs', `${oversizedSecret}.txt`),
    'x'.repeat(1024 * 1024 + 1),
  );
  expectNoSecretDiagnostic(
    (io) => memoryCheck(oversized.runtime, oversized.project, io),
    oversizedSecret,
  );

  const aggregate = fixture();
  initProject(aggregate.runtime, aggregate.project, capturedIo());
  const aggregateRoot = join(aggregate.project, '.agent-docs');
  const oneMiB = 'x'.repeat(1024 * 1024);
  for (let index = 0; index < 8; index += 1) {
    writeFileSync(join(aggregateRoot, `fill-${index}.txt`), oneMiB);
  }
  const aggregateSecret = `ghp_${'I'.repeat(24)}`;
  writeFileSync(join(aggregateRoot, `zz-${aggregateSecret}.txt`), 'x');
  expectNoSecretDiagnostic(
    (io) => memoryCheck(aggregate.runtime, aggregate.project, io),
    aggregateSecret,
  );
});

test('secret scanning covers CSV and unknown managed file extensions', () => {
  for (const [extension, marker] of [
    ['csv', 'J'],
    ['blob', 'K'],
  ] as const) {
    const { project, runtime } = fixture();
    initProject(runtime, project, capturedIo());
    const secret = `ghp_${marker.repeat(24)}`;
    writeFileSync(join(project, '.agent-docs', `managed.${extension}`), `value,${secret}\n`);

    expectNoSecretDiagnostic((io) => memoryCheck(runtime, project, io), secret);
  }
});

test('typed handoff mutations preflight invalid secret-bearing state without changing bytes', () => {
  const { project, runtime } = fixture();
  const options = {
    session: 'secret-status',
    title: 'Safe handoff',
    objective: 'Preserve the current state.',
    completed: 'Created a baseline.',
    next: 'Continue safely.',
    reason: 'phase' as const,
  };
  const handoff = captureHandoff(runtime, project, options, capturedIo());
  const secret = `ghp_${'F'.repeat(24)}`;
  const tampered = readFileSync(handoff.path, 'utf8').replace(
    /^status: active$/m,
    `status: ${secret}`,
  );
  writeFileSync(handoff.path, tampered);

  expectNoSecretDiagnostic(
    (io) => captureHandoff(runtime, project, { ...options, completed: 'Must not write.' }, io),
    secret,
  );
  expectNoSecretDiagnostic(
    (io) => closeHandoff(runtime, project, { session: options.session, outcome: 'cancelled' }, io),
    secret,
  );
  assert.equal(readFileSync(handoff.path, 'utf8'), tampered);
});

test('profile reconciliation preflights invalid secret-bearing autopilot state', () => {
  const { runtime } = fixture();
  const baseline = reconcileProfile(
    runtime,
    {
      key: 'communication.language',
      conclusion: 'Prefers Simplified Chinese.',
      evidence: 'explicit',
      confidence: 'high',
    },
    capturedIo(),
  );
  const secret = `ghp_${'G'.repeat(24)}`;
  const tampered = readFileSync(baseline.path, 'utf8').replace(
    /^profile-autopilot: enabled$/m,
    `profile-autopilot: ${secret}`,
  );
  writeFileSync(baseline.path, tampered);

  expectNoSecretDiagnostic(
    (io) =>
      reconcileProfile(
        runtime,
        {
          key: 'communication.detail',
          conclusion: 'Prefers concise conclusions.',
          evidence: 'explicit',
          confidence: 'high',
        },
        io,
      ),
    secret,
  );
  assert.equal(readFileSync(baseline.path, 'utf8'), tampered);
});

test('typed command request fields reject secrets without echoing their values', () => {
  const { project, runtime } = fixture();
  const secret = `ghp_${'L'.repeat(24)}`;
  const operations = [
    (io: ReturnType<typeof capturedIo>) =>
      captureInput(
        runtime,
        project,
        { title: 'Safe input', content: 'Safe content', source: secret as 'chat' },
        io,
      ),
    (io: ReturnType<typeof capturedIo>) =>
      captureHandoff(
        runtime,
        project,
        {
          session: 'safe-session',
          title: 'Safe handoff',
          objective: 'Keep fields private.',
          completed: 'Prepared the request.',
          next: 'Reject it.',
          reason: secret as 'phase',
        },
        io,
      ),
    (io: ReturnType<typeof capturedIo>) =>
      closeHandoff(runtime, project, { session: secret, outcome: 'cancelled' }, io),
    (io: ReturnType<typeof capturedIo>) =>
      reconcileProfile(
        runtime,
        {
          key: 'communication.secret',
          conclusion: 'Safe conclusion.',
          evidence: 'explicit',
          confidence: secret as 'high',
        },
        io,
      ),
    (io: ReturnType<typeof capturedIo>) => removeProfileEntry(runtime, { key: secret }, io),
    (io: ReturnType<typeof capturedIo>) =>
      setProfileAutopilot(runtime, { state: secret as 'enabled' }, io),
    (io: ReturnType<typeof capturedIo>) => archiveMemory(runtime, project, secret, {}, io),
    (io: ReturnType<typeof capturedIo>) =>
      memorySearch(runtime, project, secret, io, { json: true }),
  ];

  for (const operation of operations) {
    const io = capturedIo();
    let message = '';
    try {
      operation(io);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /secret material/i);
    assert.doesNotMatch(message, new RegExp(secret));
    assert.doesNotMatch([...io.logs, ...io.errors].join('\n'), new RegExp(secret));
  }
});

test('CLI output boundary redacts secret-bearing successful reports', () => {
  const { project, runtime } = fixture();
  const secret = `ghp_${'M'.repeat(24)}`;
  const io = capturedIo();
  const harnessRoot = join(project, 'secret-harness');
  mkdirSync(harnessRoot);
  writeFileSync(
    join(harnessRoot, 'manifest.json'),
    JSON.stringify({
      harnessVersion: secret,
      schemaVersion: 1,
      memorySchemaVersion: 1,
      node: '>=22',
    }),
  );
  const secretRuntime = { ...runtime, harnessRoot };

  assert.equal(runCli(['version', '--json'], { runtime: secretRuntime, io }), 0);
  assert.deepEqual(io.errors, []);
  assert.equal(io.logs.length, 1);
  assert.match(io.logs[0], /output redacted.*secret material/i);
  assert.doesNotMatch(io.logs[0], new RegExp(secret));
});

test('task request fields reject secrets before validation can echo them', () => {
  const { project, runtime } = fixture();
  const secret = `ghp_${'N'.repeat(24)}`;
  const operations = [
    (io: ReturnType<typeof capturedIo>) =>
      initTask(
        runtime,
        { project, id: secret, objective: 'Safe objective', acceptance: ['Safe'] },
        io,
      ),
    (io: ReturnType<typeof capturedIo>) => taskStatus({ project, id: secret }, io),
    (io: ReturnType<typeof capturedIo>) =>
      checkpointTask({ project, id: 'safe-id', summary: 'Safe', status: secret as 'pending' }, io),
    (io: ReturnType<typeof capturedIo>) =>
      updateAcceptance(
        {
          project,
          id: 'safe-id',
          criterion: secret,
          status: 'inconclusive',
        },
        io,
      ),
    (io: ReturnType<typeof capturedIo>) =>
      closeTask({ project, id: 'safe-id', summary: 'Safe', status: secret as 'complete' }, io),
    (io: ReturnType<typeof capturedIo>) =>
      verifyAcceptance(
        {
          project,
          id: 'safe-id',
          criterion: 'criterion-1',
          type: secret as 'test',
        },
        io,
      ),
  ];

  for (const operation of operations) {
    const io = capturedIo();
    let message = '';
    try {
      operation(io);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /secret material/i);
    assert.doesNotMatch(message, new RegExp(secret));
    assert.doesNotMatch([...io.logs, ...io.errors].join('\n'), new RegExp(secret));
  }
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});
