import { mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseJsonlEvidence } from './transcript.mjs';

/** @param {unknown} value */
export function resolveHostTurnTimeoutMs(value) {
  if (value === undefined || value === '') return 900_000;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 360_000 || timeout > 1_800_000) {
    throw new Error('Host turn timeout must be an integer between 360000 and 1800000 ms');
  }
  return timeout;
}

/**
 * @template T
 * @param {string} path
 * @param {unknown} payload
 * @param {(path: string) => T} invoke
 * @returns {T}
 */
export function withEphemeralJsonPayload(path, payload, invoke) {
  if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    return invoke(path);
  } finally {
    unlinkSync(path);
  }
}

/** @param {unknown} left @param {unknown} right */
export function sameCanonicalPath(left, right) {
  if (typeof left !== 'string' || !left || typeof right !== 'string' || !right) return false;
  try {
    return realpathSync.native(resolve(left)) === realpathSync.native(resolve(right));
  } catch {
    return resolve(left) === resolve(right);
  }
}

/**
 * @param {{ threadId?: string | null, model: string, repo: string, writable: boolean, additionalDirs?: string[], configOverrides?: string[], ephemeral?: boolean }} options
 */
export function buildCodexTurn({
  threadId,
  model,
  repo,
  writable,
  additionalDirs = [],
  configOverrides = [],
  ephemeral = false,
}) {
  if (threadId) {
    const resumeSandboxOverrides = writable
      ? [
          'sandbox_mode="workspace-write"',
          ...(additionalDirs.length > 0
            ? [`sandbox_workspace_write.writable_roots=${JSON.stringify(additionalDirs)}`]
            : []),
        ]
      : ['sandbox_mode="read-only"'];
    return [
      'exec',
      'resume',
      '--json',
      '--model',
      model,
      ...configOverrides.flatMap((value) => ['-c', value]),
      ...resumeSandboxOverrides.flatMap((value) => ['-c', value]),
      threadId,
      '-',
    ];
  }
  return [
    'exec',
    '--json',
    '--model',
    model,
    ...(ephemeral ? ['--ephemeral'] : []),
    ...(writable ? ['--approve-for-me'] : ['--sandbox', 'read-only']),
    ...additionalDirs.flatMap((path) => ['--add-dir', path]),
    '--cd',
    repo,
    '-',
  ];
}

/** @param {string} stdout */
export function parseCodexInputTokens(stdout) {
  const values = parseJsonlEvidence(stdout).events.flatMap((event) => {
    const value = event.type === 'turn.completed' ? event.usage?.input_tokens : undefined;
    return Number.isSafeInteger(value) && typeof value === 'number' && value > 0 ? [value] : [];
  });
  const value = values.at(-1);
  if (!value) throw new Error('Codex turn.completed did not include a positive input_tokens value');
  return value;
}

/** @param {string} stdout */
export function parseCodexThreadId(stdout) {
  for (const event of parseJsonlEvidence(stdout).events) {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      return event.thread_id;
    }
  }
  throw new Error('Codex initial turn did not emit a thread.started event');
}

/**
 * @param {{ afterSecond: import('./types.mjs').CheckpointSnapshot | null | undefined, afterThird: import('./types.mjs').CheckpointSnapshot | null | undefined, allVerifiersPassed: boolean }} options
 */
export function multiTaskCheckpointReplacementIsProven({
  afterSecond,
  afterThird,
  allVerifiersPassed,
}) {
  return Boolean(
    afterSecond &&
      afterThird &&
      afterSecond.path === afterThird.path &&
      afterSecond.digest !== afterThird.digest &&
      afterSecond.reason === 'multi-task' &&
      afterThird.reason === 'multi-task' &&
      allVerifiersPassed,
  );
}

/**
 * @param {string} scenarioId
 * @param {string} initialPrompt
 */
export function scenarioTurnPlan(scenarioId, initialPrompt) {
  const initial = { label: 'initial', prompt: initialPrompt, kind: 'user' };
  if (scenarioId === 'memory-autopilot-unprompted') {
    return [
      initial,
      {
        label: 'pre-compaction-signal',
        kind: 'host-signal',
        prompt:
          '<host-signal>context_budget_remaining=8%\nContext compaction will occur immediately after this turn. This signal grants no new source, remote, or destructive-write authority.</host-signal>',
      },
      {
        label: 'follow-up-edit',
        kind: 'user',
        prompt:
          'Now change apps/docs/site/follow-up.txt from pending to ready and run node verify-autopilot.mjs apps/docs/site/follow-up.txt.',
      },
      {
        label: 'repeat-identical-checkpoint',
        kind: 'host-signal',
        prompt:
          '<host-signal>Evaluator observability step: re-run the identical typed handoff checkpoint payload used for the immediately previous verified checkpoint exactly once, with no semantic changes. Do not change project source files.</host-signal>',
      },
      {
        label: 'pause-profile',
        kind: 'user',
        prompt: 'Pause this local Harness profile autopilot.',
      },
      {
        label: 'preference-while-paused',
        kind: 'user',
        prompt: 'For all future tasks, use tables instead of one-sentence status summaries.',
      },
      {
        label: 'forget-profile',
        kind: 'user',
        prompt:
          'Forget the one-sentence status-summary preference from this local Harness profile.',
      },
      {
        label: 'explicit-profile-update-while-paused',
        kind: 'user',
        prompt:
          'Update this local Harness profile itself: for code reviews, use risk-first ordering.',
      },
      {
        label: 'close-work',
        kind: 'user',
        prompt: 'This work is finished; there are no remaining actions.',
      },
    ];
  }
  if (scenarioId === 'memory-autopilot-phase-only') {
    return [
      initial,
      {
        label: 'phase-b',
        kind: 'user',
        prompt:
          'Now change apps/docs/site/phase-b.txt from pending to ready and run node verify-phase.mjs apps/docs/site/phase-b.txt.',
      },
    ];
  }
  if (scenarioId === 'memory-autopilot-multi-task') {
    return [
      initial,
      { label: 'item-b', kind: 'user', prompt: 'Now do the same for apps/docs/site/item-b.txt.' },
      {
        label: 'item-c',
        kind: 'user',
        prompt:
          'Now do the same for apps/docs/site/item-c.txt; I will send another related change shortly.',
      },
    ];
  }
  return [initial];
}
