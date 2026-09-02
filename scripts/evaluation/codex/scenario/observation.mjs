import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { runBoundedHostProcess } from '../eval-codex-transport.ts';
import { buildCodexTurn } from '../support/host.mjs';
import { sanitizeAndBoundArtifact } from '../support/artifacts.mjs';
import { parseJsonlEvidence } from '../support/transcript.mjs';

export function jsonEvents(stdout) {
  return parseJsonlEvidence(stdout).events;
}

export function createScenarioObservation(config) {
  const { repo, scenarioId, nodeBin, model, host, home, commonEnv, configHomePath, harnessBin, scenarioSignal, maxOutputBytes, evaluatorErrors, fixturePaths, memory, personal, temp, runtime } = config;
  const { run, safeReadFile, markdownFiles, treeSnapshot, exactJsonObject } = runtime;
function status() {
  const state = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo });
  if (state.status !== 0) {
    evaluatorErrors.push(`git status failed: ${state.stderr || state.error || String(state.status)}`);
  }
  return state.stdout;
}

function gitHead() {
  const state = run('git', ['rev-parse', 'HEAD'], { cwd: repo });
  if (state.status !== 0) {
    evaluatorErrors.push(`git rev-parse HEAD failed: ${state.stderr || state.error || String(state.status)}`);
    return null;
  }
  return state.stdout.trim();
}

function hostCommand(threadId, persistent, configOverrides = []) {
  const writable = ![
    'bootstrap-global-memory',
    'progressive-disclosure',
    'destructive-boundary',
  ].includes(scenarioId);
  return {
    command: 'codex',
    args: buildCodexTurn({
      threadId,
      model,
      repo,
      writable,
      additionalDirs: [
        ...(scenarioId === 'cross-repository-map-writeback' ? [dirname(personal)] : []),
        ...(['memory-autopilot-unprompted', 'memory-profile-cross-task-recall'].includes(scenarioId)
          ? [dirname(memory)]
          : []),
      ],
      configOverrides,
      ephemeral: !persistent,
    }),
    env: { ...commonEnv, HOME: home, CODEX_HOME: configHomePath() },
    version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'Codex CLI',
    model,
    modelVersion: model,
  };
}

async function runHostCommand(invocation, prompt) {
  const capture = await runBoundedHostProcess({
    invocation: {
      executable: invocation.command,
      args: invocation.args,
      cwd: repo,
      env: invocation.env,
    },
    prompt,
    signal: scenarioSignal,
    maxOutputBytes,
  });
  if (capture.kind === 'completed') {
    return { status: 0, signal: null, stdout: capture.stdout, stderr: capture.stderr };
  }
  if (capture.kind === 'transport-failure') {
    return {
      status: null,
      signal: capture.reason === 'canceled' ? 'SIGTERM' : null,
      stdout: '',
      stderr: '',
      error: `transport-failure:${capture.reason}`,
      captureKind: capture.kind,
    };
  }
  if (capture.reason === 'host-exit') {
    return {
      status: capture.exitCode,
      signal: null,
      stdout: capture.stdout,
      stderr: capture.stderr,
      error: 'evaluator-failure:host-exit',
      captureKind: capture.kind,
    };
  }
  return {
    status: null,
    signal: null,
    stdout: '',
    stderr: '',
    error: `evaluator-failure:${capture.reason}`,
    captureKind: capture.kind,
  };
}

function fileDigest(path) {
  const state = safeReadFile(path, 8 * 1024 * 1024);
  return state.ok ? state.sha256 : null;
}

function markdownTreeDigest(directory) {
  if (!existsSync(directory)) return null;
  const hash = createHash('sha256');
  for (const path of markdownFiles(directory).sort()) {
    const state = safeReadFile(path, 256 * 1024);
    if (!state.ok) {
      evaluatorErrors.push(`cannot hash Markdown file ${path}: ${state.error}`);
      return null;
    }
    hash.update(`${relative(directory, path)}\0`);
    hash.update(state.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function scalar(content, key) {
  return String(content ?? '').match(new RegExp(`^${key}: ["']?([^"'\\r\\n]+)["']?$`, 'm'))?.[1]?.trim();
}

function sessionSnapshots(sessionBase) {
  const root = join(repo, '.agent-docs');
  if (!existsSync(root)) return [];
  return markdownFiles(root).flatMap((path) => {
    const state = safeReadFile(path, 256 * 1024);
    if (!state.ok) {
      evaluatorErrors.push(`cannot snapshot session file ${path}: ${state.error}`);
      return [];
    }
    const content = state.text;
    if (scalar(content, 'session-base') !== sessionBase) return [];
    const reference = `memory:${relative(root, path).replace(/\.md$/, '')}`;
    return [{
      path,
      reference,
      status: scalar(content, 'status'),
      reason: scalar(content, 'checkpoint-reason'),
      digest: digest(content),
      content,
    }];
  });
}

function completedCommandItems(turn) {
  return jsonEvents(turn?.result?.stdout).flatMap((event) =>
    event?.type === 'item.completed' && event?.item?.type === 'command_execution'
      ? [{
          command: String(event.item.command ?? ''),
          aggregatedOutput: String(event.item.aggregated_output ?? ''),
          exitCode: event.item.exit_code,
          status: event.item.status,
        }]
      : [],
  );
}

function turnAgentMessages(turn) {
  return jsonEvents(turn?.result?.stdout ?? '').flatMap((event) =>
    event?.type === 'item.completed' && event?.item?.type === 'agent_message'
      ? [String(event.item.text ?? '')]
      : [],
  );
}

function turnVisibleAgentMessages(turn) {
  return visibleAgentMessages(turn?.result?.stdout ?? '');
}

function turnCommands(turn) {
  const events = jsonEvents(turn.result.stdout);
  const started = events.flatMap((event) =>
    event?.type === 'item.started' && event?.item?.type === 'command_execution'
      ? [String(event.item.command ?? '')]
      : [],
  );
  if (started.length > 0) return started;
  return events.flatMap((event) =>
    event?.type === 'item.completed' && event?.item?.type === 'command_execution'
      ? [String(event.item.command ?? '')]
      : [],
  );
}

function observeMemoryCheck(scope) {
  const result = run(
    nodeBin,
    [harnessBin(), 'memory', 'check', scope, '--json'],
    { cwd: repo, env: { ...commonEnv, HOME: home } },
  );
  const output = exactJsonObject(result.stdout);
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    valid: Boolean(
      result.status === 0 &&
        output?.version === 1 &&
        output?.valid === true &&
        output?.indexed === false,
    ),
    diagnostics: sanitizeAndBoundArtifact(result.stderr, 2048).content,
  };
}

function observeState() {
  const profilePath = join(memory, 'profile.md');
  const projectCorePath = join(repo, '.agent-docs', 'core.md');
  const profileState = safeReadFile(profilePath, 256 * 1024);
  const projectCoreState = safeReadFile(projectCorePath, 256 * 1024);
  return {
    at: new Date().toISOString(),
    projectMemoryDigest: markdownTreeDigest(join(repo, '.agent-docs')),
    profileDigest: fileDigest(profilePath),
    profile: profileState.ok ? profileState.text : null,
    globalMemoryCheck: observeMemoryCheck('global'),
    projectCore: projectCoreState.ok ? projectCoreState.text : null,
    handoffs: {
      'host-thread-42': sessionSnapshots('host-thread-42'),
      'phase-thread-17': sessionSnapshots('phase-thread-17'),
      'multi-thread-23': sessionSnapshots('multi-thread-23'),
    },
    trackedStatus: status(),
    trees: {
      project: treeSnapshot(repo, { excludeGit: true }),
      globalMemory: treeSnapshot(memory),
      personal: treeSnapshot(personal),
      target: fixturePaths.target
        ? treeSnapshot(fixturePaths.target, { excludeGit: true })
        : null,
      outside: fixturePaths.outside ? treeSnapshot(fixturePaths.outside) : null,
      evaluator: fixturePaths.captureWrapper
        ? treeSnapshot(dirname(fixturePaths.captureWrapper))
        : null,
    },
    captureWrapperSha256: fixturePaths.captureWrapper
      ? fileDigest(fixturePaths.captureWrapper)
      : null,
  };
}

  return { status, gitHead, hostCommand, runHostCommand, fileDigest, markdownTreeDigest, scalar, sessionSnapshots, jsonEvents, completedCommandItems, turnAgentMessages, turnVisibleAgentMessages, turnCommands, observeMemoryCheck, observeState };
}
