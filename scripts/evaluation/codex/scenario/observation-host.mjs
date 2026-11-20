import { dirname } from 'node:path';
import { runBoundedHostProcess } from '../eval-codex-transport.ts';
import { buildCodexTurn } from '../support/host.mjs';

/**
 * @typedef {{ repo: string, scenarioId: string, nodeBin: string, model: string, host: string, home: string, commonEnv: Record<string, string>, configHomePath: () => string, scenarioSignal: AbortSignal, maxOutputBytes: number, memory: string, personal: string }} HostObservationConfig
 * @typedef {import('../support/types.mjs').HostInvocation} HostInvocation
 */

/**
 * @param {HostObservationConfig} config
 * @param {string | null} threadId
 * @param {boolean} persistent
 * @param {string[]} [configOverrides]
 */
function hostCommand(config, threadId, persistent, configOverrides = []) {
  const { repo, scenarioId, model, home, commonEnv, configHomePath, memory, personal } = config;
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
      configOverrides: [
        ...(configOverrides.some((value) => value.startsWith('model_reasoning_effort='))
          ? []
          : ['model_reasoning_effort="medium"']),
        ...configOverrides,
      ],
      ephemeral: !persistent,
    }),
    env: { ...commonEnv, HOME: home, CODEX_HOME: configHomePath() },
    version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'Codex CLI',
    model,
    modelVersion: process.env.HARNESS_EVAL_MODEL_VERSION ?? 'unspecified',
  };
}

/**
 * @param {HostObservationConfig} config
 * @param {HostInvocation} invocation
 * @param {string} prompt
 * @returns {Promise<import('../support/types.mjs').HostResult>}
 */
async function runHostCommand(config, invocation, prompt) {
  const capture = await runBoundedHostProcess({
    invocation: {
      executable: invocation.command,
      args: invocation.args,
      cwd: config.repo,
      env: invocation.env,
    },
    prompt,
    signal: config.scenarioSignal,
    maxOutputBytes: config.maxOutputBytes,
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

/** @param {HostObservationConfig} config */
export function createHostObservation(config) {
  return {
    hostCommand: (
      /** @type {string | null} */ threadId,
      /** @type {boolean} */ persistent,
      /** @type {string[]} */ overrides = [],
    ) => hostCommand(config, threadId, persistent, overrides),
    runHostCommand: (/** @type {HostInvocation} */ invocation, /** @type {string} */ prompt) =>
      runHostCommand(config, invocation, prompt),
  };
}
