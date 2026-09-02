import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory/memory.js';
import { captureHandoff } from '../commands/memory/memory-autopilot.js';
import { captureInput } from '../commands/memory/memory-input.js';
import {
  reconcileProfile,
  removeProfileEntry,
  setProfileAutopilot,
} from '../commands/memory/memory-profile.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

test('summarized input identity uses normalized content across title and date paths', () => {
  const { project, runtime } = fixture('harness-input-identity-');
  const first = captureInput(runtime, project, {
    title: 'Original title',
    content: '  Durable input\r\nwith two lines.  ',
    source: 'chat',
    summary: true,
  });
  const inputFilename = basename(first.path);
  assert.match(inputFilename, /-[a-f0-9]{64}\.md$/);
  const priorDatePath = join(project, '.agent-docs', 'inputs', '2020', '01', '02', inputFilename);
  mkdirSync(dirname(priorDatePath), { recursive: true });
  renameSync(first.path, priorDatePath);
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8').replace(
      first.reference,
      `memory:inputs/2020/01/02/${inputFilename.replace(/\.md$/, '')}`,
    ),
  );

  const repeated = captureInput(runtime, project, {
    title: 'Different title',
    content: 'Durable input\nwith two lines.',
    source: 'chat',
    summary: true,
  });

  assert.equal(repeated.action, 'unchanged');
  assert.equal(realpathSync.native(repeated.path), realpathSync.native(priorDatePath));
  assert.match(readFileSync(priorDatePath, 'utf8'), /^title: Original title$/m);
  assert.equal(readFileSync(corePath, 'utf8').match(/memory:inputs\//g)?.length, 1);
});

test('input capture accepts an exclusive content file payload without shell interpretation', () => {
  const { root, project, runtime } = fixture('harness-input-file-');
  const payloadPath = join(root, 'payload.txt');
  const payload = 'Keep literal `ticks`, $(commands), "quotes", and $VARIABLE.';
  writeFileSync(payloadPath, payload);

  const result = captureInput(runtime, project, {
    title: 'Literal payload',
    contentFile: payloadPath,
    source: 'file',
  });

  assert.match(
    readFileSync(result.path, 'utf8'),
    new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.throws(
    () =>
      captureInput(runtime, project, {
        title: 'Ambiguous payload',
        content: payload,
        contentFile: payloadPath,
        source: 'file',
      }),
    /exactly one of content or contentFile/i,
  );
  assert.throws(
    () => captureInput(runtime, project, { title: 'Missing payload', source: 'file' }),
    /exactly one of content or contentFile/i,
  );
});

test('summarized input is labelled as a reliable summary instead of original input', () => {
  const { project, runtime } = fixture('harness-input-summary-');
  const result = captureInput(runtime, project, {
    title: 'Long discussion summary',
    content: 'The user approved quiet local memory updates.',
    source: 'chat',
    summary: true,
  });
  const content = readFileSync(result.path, 'utf8');

  assert.match(content, /^verbatim: false$/m);
  assert.match(content, /^# 可靠摘要$/m);
  assert.doesNotMatch(content, /^# 原始输入$/m);
});

test('input identity keeps source and verbatim semantics distinct', () => {
  const { project, runtime } = fixture('harness-input-provenance-');
  const verbatimChat = captureInput(runtime, project, {
    title: 'Shared payload',
    content: 'The same visible payload.',
    source: 'chat',
  });
  const summarizedChat = captureInput(runtime, project, {
    title: 'Shared payload summary',
    content: 'The same visible payload.',
    source: 'chat',
    summary: true,
  });
  const verbatimFile = captureInput(runtime, project, {
    title: 'Shared payload file',
    content: 'The same visible payload.',
    source: 'file',
  });

  assert.equal(new Set([verbatimChat.path, summarizedChat.path, verbatimFile.path]).size, 3);
  const digests = [verbatimChat.path, summarizedChat.path, verbatimFile.path].map(
    (path) => readFileSync(path, 'utf8').match(/^content-digest: (.+)$/m)?.[1],
  );
  assert.equal(new Set(digests).size, 3);
  assert.equal(
    readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8').match(/memory:inputs\//g)?.length,
    3,
  );
});

test('input digest detects tampering and never overwrites an identity path', () => {
  const { project, runtime } = fixture('harness-input-tamper-');
  const options = {
    title: 'Immutable input',
    content: 'Original acceptance criterion.',
    source: 'chat' as const,
  };
  const result = captureInput(runtime, project, options, capturedIo());
  const tampered = readFileSync(result.path, 'utf8').replace(
    'Original acceptance criterion.',
    'Tampered acceptance criterion.',
  );
  writeFileSync(result.path, tampered);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation, { indexed: true }), /failed/i);
  assert.match(validation.errors.join('\n'), /content digest/i);
  assert.throws(
    () => captureInput(runtime, project, options, capturedIo()),
    /content digest mismatch|identity path.*already exists/i,
  );
  assert.equal(readFileSync(result.path, 'utf8'), tampered);
});

test('verbatim input treats memory-like text as data rather than an index reference', () => {
  const { project, runtime } = fixture('harness-input-reference-text-');
  const result = captureInput(
    runtime,
    project,
    {
      title: 'Literal memory syntax',
      content: 'The user literally wrote memory:does-not-exist as an example.',
      source: 'chat',
    },
    capturedIo(),
  );

  assert.match(readFileSync(result.path, 'utf8'), /memory:does-not-exist/);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
});

test('verbatim input references do not make another document reachable', () => {
  const { project, runtime } = fixture('harness-input-false-reachability-');
  const handoff = captureHandoff(
    runtime,
    project,
    {
      session: 'input-ref-target',
      title: 'Input reference target',
      objective: 'Remain reachable only from an actual index.',
      completed: 'Created the target handoff.',
      next: 'Verify reachability.',
      reason: 'phase',
    },
    capturedIo(),
  );
  captureInput(
    runtime,
    project,
    {
      title: 'Literal existing reference',
      content: `The user quoted ${handoff.reference} as raw text.`,
      source: 'chat',
    },
    capturedIo(),
  );
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    `${readFileSync(corePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.includes(handoff.reference))
      .join('\n')
      .replace(/\n+$/, '')}\n`,
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation, { indexed: true }), /issue/i);
  assert.match(validation.errors.join('\n'), /not reachable from an index/i);
});

test('duplicate input identities fail closed during validation and recapture', () => {
  const { project, runtime } = fixture('harness-input-duplicate-identity-');
  const options = {
    title: 'Unique input identity',
    content: 'One immutable payload.',
    source: 'chat' as const,
  };
  const created = captureInput(runtime, project, options, capturedIo());
  const duplicate = join(dirname(created.path), 'duplicate-input.md');
  writeFileSync(duplicate, readFileSync(created.path, 'utf8'));

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /duplicate input identity/i);
  assert.throws(
    () => captureInput(runtime, project, options, capturedIo()),
    /ambiguous input identity/i,
  );
});

test('automatic profile upsert accepts only explicit high-confidence evidence', () => {
  const { runtime } = fixture('harness-profile-evidence-');

  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'communication.observed',
        conclusion: 'Prefers short answers.',
        evidence: 'observed',
        confidence: 'high',
      }),
    /requires explicit evidence with high confidence/i,
  );
  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'communication.medium',
        conclusion: 'Prefers short answers.',
        evidence: 'explicit',
        confidence: 'medium',
      }),
    /requires explicit evidence with high confidence/i,
  );
  const accepted = reconcileProfile(runtime, {
    key: 'communication.explicit',
    conclusion: 'Prefers short answers.',
    evidence: 'explicit',
    confidence: 'high',
  });
  assert.equal(accepted.action, 'created');
  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'communication.multiline',
        conclusion: 'First line.\nSecond line.',
        evidence: 'explicit',
        confidence: 'high',
      }),
    /single line/i,
  );
});

test('identical profile state does not refresh observational dates', () => {
  const { runtime } = fixture('harness-profile-date-idempotency-');
  const options = {
    key: 'communication.date-stable',
    conclusion: 'Keep this stable across days.',
    evidence: 'explicit' as const,
    confidence: 'high' as const,
  };
  const created = reconcileProfile(runtime, options, capturedIo());
  const priorDateContent = readFileSync(created.path, 'utf8')
    .replace(/^created: .*$/m, 'created: 2000-01-01')
    .replace(/^updated: .*$/m, 'updated: 2000-01-02')
    .replace(
      /^- communication\.date-stable \| (.+) \| explicit \| high \| .*$/m,
      '- communication.date-stable | $1 | explicit | high | 2000-01-02',
    );
  writeFileSync(created.path, priorDateContent);

  const repeated = reconcileProfile(runtime, options, capturedIo());

  assert.equal(repeated.action, 'unchanged');
  assert.equal(readFileSync(created.path, 'utf8'), priorDateContent);
});

test('profile conclusions treat literal memory syntax as user data', () => {
  const { runtime } = fixture('harness-profile-literal-memory-');

  const created = reconcileProfile(
    runtime,
    {
      key: 'communication.literal-memory',
      conclusion: 'Discuss memory:not-a-reference literally.',
      evidence: 'explicit',
      confidence: 'high',
    },
    capturedIo(),
  );

  assert.match(readFileSync(created.path, 'utf8'), /memory:not-a-reference/);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo(), { indexed: true }));
});

test('profile removal forgets one exact key and is idempotent', () => {
  const { runtime } = fixture('harness-profile-remove-');
  for (const key of ['communication.short', 'communication.shorter']) {
    reconcileProfile(runtime, {
      key,
      conclusion: `Preference for ${key}.`,
      evidence: 'explicit',
      confidence: 'high',
    });
  }

  const removed = removeProfileEntry(runtime, { key: 'communication.short' });
  const repeated = removeProfileEntry(runtime, { key: 'communication.short' });
  const profile = readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8');

  assert.equal(removed.action, 'updated');
  assert.equal(repeated.action, 'unchanged');
  assert.doesNotMatch(profile, /^- communication\.short \|/m);
  assert.match(profile, /^- communication\.shorter \|/m);
});

test('profile capacity permits replacement, rejects overflow, and reopens after removal', () => {
  const { runtime } = fixture('harness-profile-capacity-');
  for (let index = 0; index < 32; index += 1) {
    reconcileProfile(runtime, {
      key: `capacity.entry-${index}`,
      conclusion: `Profile entry ${index}.`,
      evidence: 'explicit',
      confidence: 'high',
    });
  }

  const replacement = reconcileProfile(runtime, {
    key: 'capacity.entry-0',
    conclusion: 'Updated profile entry.',
    evidence: 'explicit',
    confidence: 'high',
  });
  assert.equal(replacement.action, 'updated');
  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'capacity.overflow',
        conclusion: 'This must not evict another entry.',
        evidence: 'explicit',
        confidence: 'high',
      }),
    /capacity.*32/i,
  );
  assert.doesNotMatch(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /capacity\.overflow/,
  );
  removeProfileEntry(runtime, { key: 'capacity.entry-1' }, capturedIo());
  const afterRemoval = reconcileProfile(runtime, {
    key: 'capacity.after-removal',
    conclusion: 'The freed slot is reusable.',
    evidence: 'explicit',
    confidence: 'high',
  });
  assert.equal(afterRemoval.action, 'created');
});

test('profile autopilot can be paused, still allows forgetting, and resumes explicitly', () => {
  const { runtime } = fixture('harness-profile-pause-');
  reconcileProfile(runtime, {
    key: 'communication.detail',
    conclusion: 'Prefer concise answers.',
    evidence: 'explicit',
    confidence: 'high',
  });

  setProfileAutopilot(runtime, { state: 'paused' }, capturedIo());
  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'communication.detail',
        conclusion: 'Prefer detailed answers.',
        evidence: 'explicit',
        confidence: 'high',
      }),
    /profile autopilot is paused/i,
  );
  assert.equal(
    reconcileProfile(
      runtime,
      {
        key: 'communication.detail',
        conclusion: 'Prefer detailed answers.',
        evidence: 'explicit',
        confidence: 'high',
        userDirected: true,
      },
      capturedIo(),
    ).action,
    'updated',
  );
  assert.match(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /^profile-autopilot: paused$/m,
  );
  assert.equal(
    removeProfileEntry(runtime, { key: 'communication.detail' }, capturedIo()).action,
    'updated',
  );
  setProfileAutopilot(runtime, { state: 'enabled' }, capturedIo());
  assert.equal(
    reconcileProfile(runtime, {
      key: 'communication.detail',
      conclusion: 'Prefer detailed answers.',
      evidence: 'explicit',
      confidence: 'high',
    }).action,
    'created',
  );
  assert.match(
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
    /^profile-autopilot: enabled$/m,
  );
});
