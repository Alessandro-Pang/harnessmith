import { isAbsolute, join, resolve } from 'node:path';
import {
  evaluateCodexTurnCompletion,
  extractHandoffInvocations,
  inspectJsonPayloadPath,
  inspectProjectScopePath,
  markEarlierReusedPayloadSnapshotsAmbiguous,
  memoryPayloadCommandHasExpectedPrefix,
  parseMemoryPayloadCommand,
  sameCanonicalPath,
} from '../eval-codex-support.mjs';
import { jsonEvents } from './observation.mjs';
import { exactJsonObject } from './runtime.mjs';

/**
 * @typedef {{ scenarioId: string, host: string, repo: string, temp: string, nodeBin: string, harnessBin: () => string, verifierDigests: Map<string, string | null>, fileDigest: (path: string) => string | null, run: (command: string, args: string[], options?: import('../support/types.mjs').RunOptions) => import('../support/types.mjs').HostResult, safeReadFile: (path: string, maxBytes?: number) => import('../support/types.mjs').SafeReadState, digest: (content: string | Buffer) => string, canonicalJson: (value: unknown) => unknown }} EvidenceConfig
 */

/** @param {EvidenceConfig} config @param {string} label */
function turnVerifier(config, label) {
  /** @type {Record<string, string[]>} */
  const targets = {
    'memory-autopilot-unprompted:initial': ['verify-autopilot.mjs', 'apps/docs/site/status.txt'],
    'memory-autopilot-unprompted:follow-up-edit': [
      'verify-autopilot.mjs',
      'apps/docs/site/follow-up.txt',
    ],
    'memory-autopilot-phase-only:initial': ['verify-phase.mjs', 'apps/docs/site/phase-a.txt'],
    'memory-autopilot-phase-only:phase-b': ['verify-phase.mjs', 'apps/docs/site/phase-b.txt'],
    'memory-autopilot-multi-task:initial': ['verify-item.mjs', 'apps/docs/site/item-a.txt'],
    'memory-autopilot-multi-task:item-b': ['verify-item.mjs', 'apps/docs/site/item-b.txt'],
    'memory-autopilot-multi-task:item-c': ['verify-item.mjs', 'apps/docs/site/item-c.txt'],
    'memory-profile-cross-task-recall:initial': ['verify-recall.mjs', 'apps/docs/site/status.txt'],
  };
  const target = targets[`${config.scenarioId}:${label}`];
  if (!target) return null;
  const verifierPath = join(config.repo, target[0]);
  const expectedSha256 = config.verifierDigests.get(target[0]);
  const actualSha256 = config.fileDigest(verifierPath);
  if (!expectedSha256 || actualSha256 !== expectedSha256) {
    return {
      command: [config.nodeBin, ...target],
      status: null,
      signal: null,
      stdout: '',
      stderr: 'verifier integrity mismatch; execution refused',
      integrity: false,
      expectedSha256,
      actualSha256,
    };
  }
  const executed = config.run(config.nodeBin, target, { cwd: config.repo });
  return {
    command: [config.nodeBin, ...target],
    status: executed.status ?? null,
    signal: executed.signal ?? null,
    stdout: executed.stdout,
    stderr: executed.stderr ?? '',
    integrity: true,
    expectedSha256,
    actualSha256,
  };
}

/** @param {EvidenceConfig} config @param {unknown} stdout */
function captureHandoffEvidence(config, stdout) {
  const evidence = extractHandoffInvocations(stdout).map((item) => {
    const resolvedPayloadPath = isAbsolute(item.payloadPath)
      ? resolve(item.payloadPath)
      : resolve(config.repo, item.payloadPath);
    const payloadPathInspection = inspectJsonPayloadPath(resolvedPayloadPath, config.temp);
    if (!payloadPathInspection.ok) {
      return {
        ...item,
        resolvedPayloadPath,
        payload: { ok: false, error: payloadPathInspection.error },
      };
    }
    const state = config.safeReadFile(resolvedPayloadPath, 1024 * 1024);
    if (!state.ok) return { ...item, resolvedPayloadPath, payload: state };
    const value = exactJsonObject(state.text);
    return {
      ...item,
      resolvedPayloadPath,
      payload: {
        ok: Boolean(value),
        size: state.size,
        fileSha256: state.sha256,
        canonicalJsonSha256: value
          ? config.digest(JSON.stringify(config.canonicalJson(value)))
          : null,
        value,
        error: value ? null : 'payload is not exactly one JSON object',
      },
    };
  });
  return markEarlierReusedPayloadSnapshotsAmbiguous(evidence);
}

/** @param {EvidenceConfig} config @param {unknown} stdout @param {string} turnLabel */
function captureMemoryPayloadEvidence(config, stdout, turnLabel) {
  const evidence = jsonEvents(stdout).flatMap((event) => {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'command_execution') return [];
    const command = String(item.command ?? '');
    const parsedCommand = parseMemoryPayloadCommand(command);
    if (!parsedCommand) return [];
    const { action, harnessIndex, payloadPath, scopePath, tokens } = parsedCommand;
    const resolvedPayloadPath = payloadPath
      ? isAbsolute(payloadPath)
        ? resolve(payloadPath)
        : resolve(config.repo, payloadPath)
      : null;
    const payloadInspection = resolvedPayloadPath
      ? inspectJsonPayloadPath(resolvedPayloadPath, config.temp)
      : { ok: false, error: 'missing unique --payload-file value' };
    const resolvedScopePath = scopePath
      ? isAbsolute(scopePath)
        ? resolve(scopePath)
        : resolve(config.repo, scopePath)
      : null;
    const scopeInspection =
      action === 'reconcile-profile'
        ? { ok: true, exists: true, resolvedPath: null }
        : resolvedScopePath
          ? inspectProjectScopePath(resolvedScopePath, config.repo)
          : { ok: true, exists: false, resolvedPath: null };
    const exact =
      memoryPayloadCommandHasExpectedPrefix({
        commandTokens: tokens,
        harnessIndex,
        nodePath: config.nodeBin,
        harnessPath: config.harnessBin(),
        repo: config.repo,
      }) && expectedPayloadSuffix(config, parsedCommand);
    /** @type {import('../support/types.mjs').SafeReadState} */
    const payloadState =
      resolvedPayloadPath && payloadInspection.ok
        ? config.safeReadFile(resolvedPayloadPath, 1024 * 1024)
        : {
            ok: false,
            path: resolvedPayloadPath ?? '',
            error: payloadInspection.error ?? 'payload inspection failed',
          };
    const payloadValue = payloadState.ok ? exactJsonObject(payloadState.text) : null;
    const rawOutput = String(item.aggregated_output ?? '');
    return [
      {
        turn: turnLabel,
        action,
        exact,
        command,
        resolvedPayloadPath,
        payloadPathOk: payloadInspection.ok,
        resolvedScopePath,
        scopePathOk: scopeInspection.ok,
        scopeExists: scopeInspection.exists,
        payload: {
          ok: Boolean(payloadInspection.ok && payloadState.ok && payloadValue),
          value: payloadValue,
          error:
            payloadInspection.error ??
            (!payloadState.ok ? payloadState.error : undefined) ??
            (payloadValue ? null : 'payload is not exactly one JSON object'),
        },
        output: exactJsonObject(rawOutput),
        outputObserved: Boolean(rawOutput.trim()),
        completed: item.status === 'completed' && item.exit_code === 0,
      },
    ];
  });
  return markEarlierReusedPayloadSnapshotsAmbiguous(evidence);
}

/** @param {EvidenceConfig} config @param {NonNullable<ReturnType<typeof parseMemoryPayloadCommand>>} parsed */
function expectedPayloadSuffix(config, parsed) {
  const { action, payloadIndexes, tokens } = parsed;
  return Boolean(
    tokens.at(-1) === '--json' &&
      ((action === 'reconcile-profile' && tokens.length === 7 && payloadIndexes[0] === 4) ||
        (['capture-input', 'handoff'].includes(action) &&
          tokens.length === 8 &&
          payloadIndexes[0] === 5 &&
          sameCanonicalPath(
            isAbsolute(tokens[4]) ? resolve(tokens[4]) : resolve(config.repo, tokens[4]),
            config.repo,
          ))),
  );
}

/** @param {EvidenceConfig} config @param {import('../support/types.mjs').HostResult} result @param {{ kind: string } | undefined} planned */
function hostTurnCompletion(config, result, planned) {
  if (config.host === 'codex') {
    return evaluateCodexTurnCompletion(result, {
      requireAgentCompletion: planned?.kind !== 'host-signal',
    });
  }
  /** @type {string[]} */
  const reasons = [];
  if (result.status !== 0) reasons.push(`status=${String(result.status)}`);
  if (result.signal) reasons.push(`signal=${String(result.signal)}`);
  if (result.error) reasons.push(`error=${String(result.error)}`);
  if (!String(result.stdout ?? '').trim()) reasons.push('missing host completion output');
  return {
    completed:
      result.status === 0 &&
      !result.signal &&
      !result.error &&
      Boolean(String(result.stdout ?? '').trim()),
    transportFailure: false,
    hasTurnCompleted: null,
    hasAgentCompletion: Boolean(String(result.stdout ?? '').trim()),
    reasons,
  };
}

/** @param {EvidenceConfig} config */
export function createScenarioEvidence(config) {
  return {
    turnVerifier: (/** @type {string} */ label) => turnVerifier(config, label),
    captureHandoffEvidence: (/** @type {unknown} */ stdout) =>
      captureHandoffEvidence(config, stdout),
    captureMemoryPayloadEvidence: (/** @type {unknown} */ stdout, /** @type {string} */ label) =>
      captureMemoryPayloadEvidence(config, stdout, label),
    hostTurnCompletion: (
      /** @type {import('../support/types.mjs').HostResult} */ result,
      /** @type {{ kind: string } | undefined} */ planned,
    ) => hostTurnCompletion(config, result, planned),
  };
}
