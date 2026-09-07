import { isAbsolute, join, resolve } from 'node:path';
import {
  extractHandoffInvocations,
  inspectJsonPayloadPath,
  inspectProjectScopePath,
  markEarlierReusedPayloadSnapshotsAmbiguous,
  parseMemoryPayloadCommand,
  memoryPayloadCommandHasExpectedPrefix,
  sameCanonicalPath,
  evaluateCodexTurnCompletion,
} from '../eval-codex-support.mjs';
import { exactJsonObject } from './runtime.mjs';
import { jsonEvents } from './observation.mjs';

export function createScenarioEvidence({
  scenarioId,
  host,
  repo,
  temp,
  nodeBin,
  harnessBin,
  verifierDigests,
  fileDigest,
  run,
  safeReadFile,
  digest,
  canonicalJson,
}) {
  function turnVerifier(label) {
    const targets = {
      'memory-autopilot-unprompted:initial': ['verify-autopilot.mjs', 'apps/docs/site/status.txt'],
      'memory-autopilot-unprompted:follow-up-edit': ['verify-autopilot.mjs', 'apps/docs/site/follow-up.txt'],
      'memory-autopilot-phase-only:initial': ['verify-phase.mjs', 'apps/docs/site/phase-a.txt'],
      'memory-autopilot-phase-only:phase-b': ['verify-phase.mjs', 'apps/docs/site/phase-b.txt'],
      'memory-autopilot-multi-task:initial': ['verify-item.mjs', 'apps/docs/site/item-a.txt'],
      'memory-autopilot-multi-task:item-b': ['verify-item.mjs', 'apps/docs/site/item-b.txt'],
      'memory-autopilot-multi-task:item-c': ['verify-item.mjs', 'apps/docs/site/item-c.txt'],
      'memory-profile-cross-task-recall:initial': ['verify-recall.mjs', 'apps/docs/site/status.txt'],
    };
    const target = targets[`${scenarioId}:${label}`];
    if (!target) return null;
    const verifierPath = join(repo, target[0]);
    const expectedSha256 = verifierDigests.get(target[0]);
    const actualSha256 = fileDigest(verifierPath);
    if (!expectedSha256 || actualSha256 !== expectedSha256) {
      return {
        command: [nodeBin, ...target], status: null, signal: null, stdout: '',
        stderr: 'verifier integrity mismatch; execution refused', integrity: false,
        expectedSha256, actualSha256,
      };
    }
    return {
      command: [nodeBin, ...target],
      ...run(nodeBin, target, { cwd: repo }),
      integrity: true,
      expectedSha256,
      actualSha256,
    };
  }

  function captureHandoffEvidence(stdout) {
    const evidence = extractHandoffInvocations(stdout).map((item) => {
      const resolvedPayloadPath = isAbsolute(item.payloadPath)
        ? resolve(item.payloadPath)
        : resolve(repo, item.payloadPath);
      const payloadPathInspection = inspectJsonPayloadPath(resolvedPayloadPath, temp);
      if (!payloadPathInspection.ok) {
        return { ...item, resolvedPayloadPath, payload: { ok: false, error: payloadPathInspection.error } };
      }
      const state = safeReadFile(resolvedPayloadPath, 1024 * 1024);
      if (!state.ok) return { ...item, resolvedPayloadPath, payload: state };
      const value = exactJsonObject(state.text);
      return {
        ...item,
        resolvedPayloadPath,
        payload: {
          ok: Boolean(value), size: state.size, fileSha256: state.sha256,
          canonicalJsonSha256: value ? digest(JSON.stringify(canonicalJson(value))) : null,
          value, error: value ? null : 'payload is not exactly one JSON object',
        },
      };
    });
    return markEarlierReusedPayloadSnapshotsAmbiguous(evidence);
  }

  function captureMemoryPayloadEvidence(stdout, turnLabel) {
    const evidence = jsonEvents(stdout).flatMap((event) => {
      const item = event?.item;
      if (event?.type !== 'item.completed' || item?.type !== 'command_execution') return [];
      const command = String(item.command ?? '');
      const parsedCommand = parseMemoryPayloadCommand(command);
      if (!parsedCommand) return [];
      const { action, harnessIndex, payloadIndexes, payloadPath, scopePath, tokens: commandTokens } = parsedCommand;
      const resolvedPayloadPath = payloadPath
        ? (isAbsolute(payloadPath) ? resolve(payloadPath) : resolve(repo, payloadPath))
        : null;
      const payloadInspection = resolvedPayloadPath
        ? inspectJsonPayloadPath(resolvedPayloadPath, temp)
        : { ok: false, error: 'missing unique --payload-file value' };
      const resolvedScopePath = scopePath
        ? (isAbsolute(scopePath) ? resolve(scopePath) : resolve(repo, scopePath))
        : null;
      const scopeInspection = action === 'reconcile-profile'
        ? { ok: true, exists: true, resolvedPath: null }
        : resolvedScopePath
          ? inspectProjectScopePath(resolvedScopePath, repo)
          : { ok: true, exists: false, resolvedPath: null };
      const expectedPrefix = memoryPayloadCommandHasExpectedPrefix({
        commandTokens, harnessIndex, nodePath: nodeBin, harnessPath: harnessBin(), repo,
      });
      const expectedSuffix = Boolean(
        commandTokens.at(-1) === '--json' &&
        ((action === 'reconcile-profile' && commandTokens.length === 7 && payloadIndexes[0] === 4) ||
          (['capture-input', 'handoff'].includes(action) && commandTokens.length === 8 && payloadIndexes[0] === 5 &&
            sameCanonicalPath(isAbsolute(commandTokens[4]) ? resolve(commandTokens[4]) : resolve(repo, commandTokens[4]), repo))),
      );
      const payloadState = payloadInspection.ok
        ? safeReadFile(resolvedPayloadPath, 1024 * 1024)
        : { ok: false, error: payloadInspection.error };
      const payloadValue = payloadState.ok ? exactJsonObject(payloadState.text) : null;
      const rawOutput = String(item.aggregated_output ?? '');
      return [{
        turn: turnLabel, action, exact: expectedPrefix && expectedSuffix, command,
        resolvedPayloadPath, payloadPathOk: payloadInspection.ok, resolvedScopePath,
        scopePathOk: scopeInspection.ok, scopeExists: scopeInspection.exists,
        payload: { ok: Boolean(payloadInspection.ok && payloadState.ok && payloadValue), value: payloadValue,
          error: payloadInspection.error ?? payloadState.error ?? (payloadValue ? null : 'payload is not exactly one JSON object') },
        output: exactJsonObject(rawOutput), outputObserved: Boolean(rawOutput.trim()),
        completed: item.status === 'completed' && item.exit_code === 0,
      }];
    });
    return markEarlierReusedPayloadSnapshotsAmbiguous(evidence);
  }

  function hostTurnCompletion(result, planned) {
    if (host === 'codex') return evaluateCodexTurnCompletion(result, { requireAgentCompletion: planned?.kind !== 'host-signal' });
    const reasons = [];
    if (result.status !== 0) reasons.push(`status=${String(result.status)}`);
    if (result.signal) reasons.push(`signal=${String(result.signal)}`);
    if (result.error) reasons.push(`error=${String(result.error)}`);
    if (!String(result.stdout ?? '').trim()) reasons.push('missing host completion output');
    return { completed: result.status === 0 && !result.signal && !result.error && Boolean(String(result.stdout ?? '').trim()),
      transportFailure: false, hasTurnCompleted: null, hasAgentCompletion: Boolean(String(result.stdout ?? '').trim()), reasons };
  }

  return { turnVerifier, captureHandoffEvidence, captureMemoryPayloadEvidence, hostTurnCompletion };
}
