import { isMemoryAction } from './memory-types.mjs';
import { jsonEvents } from './observation-transcript.mjs';

/** @param {unknown} text */
function jsonObjects(text) {
  const source = String(text).trim();
  if (!source) return [];
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? [/** @type {import('../support/types.mjs').MemoryPayloadOutput} */ (value)]
      : [];
  } catch {
    return source.split(/\r?\n/u).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === 'object' && !Array.isArray(value)
          ? [/** @type {import('../support/types.mjs').MemoryPayloadOutput} */ (value)]
          : [];
      } catch {
        return [];
      }
    });
  }
}

/** @param {import('./memory-types.mjs').MemoryHostOutput[]} outputs */
export function lastTypedMemoryOutput(outputs) {
  const commandOutputs = outputs.flatMap((output) =>
    jsonEvents(output.stdout).flatMap((event) =>
      event.type === 'item.completed' && event.item?.type === 'command_execution'
        ? [String(event.item.aggregated_output ?? '')]
        : [],
    ),
  );
  return commandOutputs
    .flatMap(jsonObjects)
    .filter((value) => isMemoryAction(value.action))
    .at(-1);
}

/**
 * @param {import('./memory-types.mjs').MemoryScenario} scenario
 * @param {import('../../memory/memory-contract-verifier.ts').MemoryContractState} semanticInitial
 * @param {import('../../memory/memory-contract-verifier.ts').MemoryContractState} semanticFinal
 */
export function resolveMemoryContract(scenario, semanticInitial, semanticFinal) {
  /** @type {import('./memory-types.mjs').MemoryContract | undefined} */
  const contract = scenario.stateContract
    ? { ...scenario.stateContract, operation: scenario.operation }
    : scenario.id === 'explicit-profile'
      ? { kind: 'profile-create' }
      : scenario.id === 'profile-update'
        ? { kind: 'profile-update', key: 'communication.review-format' }
        : scenario.id === 'forget-profile'
          ? { kind: 'profile-forget', key: 'communication.review-format' }
          : scenario.id === 'project-constraint'
            ? { kind: 'project-input-create' }
            : scenario.id === 'one-shot-request'
              ? { kind: 'no-write' }
              : undefined;
  if (contract?.kind !== 'profile-create') return contract;

  const profileLines = profileRecordLines(semanticFinal.global);
  const beforeLines = profileRecordLines(semanticInitial.global);
  const observedKey = profileLines
    .map(profileKey)
    .find((key) => key && !beforeLines.map(profileKey).includes(key));
  if (contract.key && observedKey !== contract.key) {
    contract.key = '__profile-key-mismatch__';
  } else {
    contract.key = observedKey ?? contract.key;
  }
  return contract;
}

/** @param {Readonly<Record<string, string>>} files */
function profileRecordLines(files) {
  return Object.values(files)
    .join('\n')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('- '));
}

/** @param {string} line */
function profileKey(line) {
  return line.match(/^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \|/u)?.[1];
}
