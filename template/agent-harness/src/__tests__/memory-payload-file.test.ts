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
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-payload-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

function payloadFile(root: string, name: string, payload: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

test('capture-input accepts payload-only options and keeps --json as an inline output flag', () => {
  const { root, project, runtime } = fixture();
  const marker = join(root, 'must-not-run');
  const content = `literal "quotes" and $(touch ${marker}) and \`id\``;
  const payload = payloadFile(root, 'capture-input.json', {
    title: 'Safe JSON payload',
    content,
    source: 'chat',
    summary: true,
  });
  const io = capturedIo();

  assert.equal(
    runCli(['memory', 'capture-input', project, '--payload-file', payload, '--json'], {
      runtime,
      io,
    }),
    0,
  );

  const result = JSON.parse(io.logs[0]);
  const stored = readFileSync(result.path, 'utf8');
  assert.match(stored, /# 可靠摘要/);
  assert.ok(stored.includes(content));
});

test('payload consumption is explicit and deletes only a successfully validated payload', () => {
  const { root, project, runtime } = fixture();
  const consumed = payloadFile(root, 'consume-input.json', {
    title: 'Consumed payload',
    content: 'Delete this payload after validation.',
    source: 'chat',
  });
  assert.equal(
    runCli(
      ['memory', 'capture-input', project, '--payload-file', consumed, '--consume-payload-file'],
      { runtime, io: capturedIo() },
    ),
    0,
  );
  assert.equal(existsSync(consumed), false);

  const invalid = payloadFile(root, 'consume-invalid.json', {
    content: 'Missing title.',
    source: 'chat',
  });
  assert.throws(
    () =>
      runCli(
        ['memory', 'capture-input', project, '--payload-file', invalid, '--consume-payload-file'],
        { runtime, io: capturedIo() },
      ),
    /requires.*title/i,
  );
  assert.equal(existsSync(invalid), true);

  const rejected = payloadFile(root, 'consume-rejected.json', {
    title: 'Rejected payload',
    content: 'The schema is valid but the domain command rejects the source.',
    source: 'unsupported',
  });
  assert.throws(
    () =>
      runCli(
        ['memory', 'capture-input', project, '--payload-file', rejected, '--consume-payload-file'],
        { runtime, io: capturedIo() },
      ),
    /invalid input source/i,
  );
  assert.equal(existsSync(rejected), true);
});

test('handoff maps payload sourceRefs into recovery metadata', () => {
  const { root, project, runtime } = fixture();
  const payload = payloadFile(root, 'handoff.json', {
    session: 'payload-workstream',
    title: 'Payload workstream',
    objective: 'Exercise the JSON command boundary.',
    completed: 'The payload contract is defined.',
    next: 'Run focused verification.',
    reason: 'phase',
    scope: ['src/feature.ts'],
    sourceRefs: ['docs/contract.md'],
  });
  const io = capturedIo();

  assert.equal(
    runCli(['memory', 'handoff', project, '--payload-file', payload, '--json'], { runtime, io }),
    0,
  );

  const stored = readFileSync(JSON.parse(io.logs[0]).path, 'utf8');
  assert.match(stored, /^scope:\n {2}- src\/feature\.ts$/m);
  assert.match(stored, /^source-refs:\n {2}- docs\/contract\.md$/m);
});

test('handoff payload requires explicit clear flags instead of empty replacement lists', () => {
  const { root, project, runtime } = fixture();
  const base = {
    session: 'payload-preservation',
    title: 'Payload preservation',
    objective: 'Preserve omitted recovery lists.',
    completed: 'Captured the current scope.',
    next: 'Continue the work.',
    reason: 'phase',
  };
  const created = payloadFile(root, 'handoff-preserve-create.json', {
    ...base,
    scope: ['src/feature.ts'],
    sourceRefs: ['docs/contract.md'],
  });
  assert.equal(
    runCli(['memory', 'handoff', project, '--payload-file', created], {
      runtime,
      io: capturedIo(),
    }),
    0,
  );
  const invalid = payloadFile(root, 'handoff-preserve-invalid.json', {
    ...base,
    scope: [],
    sourceRefs: [],
  });

  assert.throws(
    () =>
      runCli(['memory', 'handoff', project, '--payload-file', invalid], {
        runtime,
        io: capturedIo(),
      }),
    /cannot be empty.*clear option/i,
  );
});

test('profile reconcile and forget commands accept payload-only options', () => {
  const { root, runtime } = fixture();
  assert.equal(runCli(['memory', 'profile-autopilot', 'pause'], { runtime, io: capturedIo() }), 0);
  const reconcile = payloadFile(root, 'reconcile-profile.json', {
    key: 'communication.detail',
    conclusion: 'Prefer concise answers.',
    evidence: 'explicit',
    confidence: 'high',
    userDirected: true,
  });
  assert.equal(
    runCli(['memory', 'reconcile-profile', '--payload-file', reconcile], {
      runtime,
      io: capturedIo(),
    }),
    0,
  );
  assert.equal(
    runCli(
      [
        'memory',
        'reconcile-profile',
        '--key',
        'communication.inline',
        '--conclusion',
        'Allow direct inline correction.',
        '--evidence',
        'explicit',
        '--confidence',
        'high',
        '--user-directed',
      ],
      { runtime, io: capturedIo() },
    ),
    0,
  );

  const forget = payloadFile(root, 'forget-profile.json', { key: 'communication.detail' });
  assert.equal(
    runCli(['memory', 'forget-profile', '--payload-file', forget, '--json'], {
      runtime,
      io: capturedIo(),
    }),
    0,
  );
  assert.doesNotMatch(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /communication\.detail/,
  );
  assert.match(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /^profile-autopilot: paused$/m,
  );
});

test('payload files conflict with inline domain options for every supported command', () => {
  const { root, project, runtime } = fixture();
  const cases: Array<{ args: string[]; payload: unknown }> = [
    {
      args: ['capture-input', project, '--title', 'Inline title'],
      payload: { title: 'Payload title', content: 'Payload body', source: 'chat' },
    },
    {
      args: ['handoff', project, '--session', 'inline-session'],
      payload: {
        session: 'payload-session',
        title: 'Payload title',
        objective: 'Payload objective',
        completed: 'Payload completion',
        next: 'Payload next action',
        reason: 'phase',
      },
    },
    {
      args: ['reconcile-profile', '--key', 'communication.inline'],
      payload: {
        key: 'communication.payload',
        conclusion: 'Prefer payloads.',
        evidence: 'explicit',
        confidence: 'high',
      },
    },
    {
      args: ['forget-profile', '--key', 'communication.inline'],
      payload: { key: 'communication.payload' },
    },
  ];

  for (const [index, item] of cases.entries()) {
    const payload = payloadFile(root, `conflict-${index}.json`, item.payload);
    assert.throws(
      () =>
        runCli(['memory', ...item.args, '--payload-file', payload, '--json'], {
          runtime,
          io: capturedIo(),
        }),
      /payload-file.*inline|inline.*payload-file/i,
    );
  }
});

test('payload files reject symlinks, oversized input, non-objects, and unknown keys', () => {
  const { root, project, runtime } = fixture();
  const valid = payloadFile(root, 'valid-target.json', {
    title: 'Safe payload',
    content: 'Safe body',
    source: 'chat',
  });
  const linked = join(root, 'linked.json');
  symlinkSync(valid, linked, 'file');
  const oversized = join(root, 'oversized.json');
  writeFileSync(oversized, 'x'.repeat(256 * 1024 + 1));
  const directory = join(root, 'payload-directory');
  mkdirSync(directory);
  const array = payloadFile(root, 'array.json', []);
  const empty = payloadFile(root, 'null.json', null);
  const unknown = payloadFile(root, 'unknown.json', {
    title: 'Safe payload',
    content: 'Safe body',
    source: 'chat',
    unexpected: true,
  });

  for (const [path, error] of [
    [linked, /regular.*non-symlink|symbolic link/i],
    [oversized, /byte|size|256/i],
    [directory, /regular.*non-symlink|regular file/i],
    [array, /plain object/i],
    [empty, /plain object/i],
    [unknown, /unknown.*unexpected|unexpected.*unknown/i],
  ] as const) {
    assert.throws(
      () =>
        runCli(['memory', 'capture-input', project, '--payload-file', path], {
          runtime,
          io: capturedIo(),
        }),
      error,
    );
  }
});

test('payload-only commands validate missing required fields and field types at runtime', () => {
  const { root, project, runtime } = fixture();
  const missing = payloadFile(root, 'missing.json', {
    content: 'Body without a title.',
    source: 'chat',
  });
  const invalidType = payloadFile(root, 'invalid-type.json', {
    title: 42,
    content: 'Body with an invalid title.',
    source: 'chat',
  });

  assert.throws(
    () =>
      runCli(['memory', 'capture-input', project, '--payload-file', missing], {
        runtime,
        io: capturedIo(),
      }),
    /requires.*title|title.*required/i,
  );
  assert.throws(
    () =>
      runCli(['memory', 'capture-input', project, '--payload-file', invalidType], {
        runtime,
        io: capturedIo(),
      }),
    /title.*string/i,
  );
});
