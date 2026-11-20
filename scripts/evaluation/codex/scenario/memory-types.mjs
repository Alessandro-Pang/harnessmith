/**
 * @typedef {'created' | 'updated' | 'unchanged' | 'no-change' | 'proposed' | 'blocked'} MemoryAction
 * @typedef {import('../../memory/memory-contract-verifier.ts').MemoryContract} MemoryContract
 * @typedef {import('../../memory/memory-state-verifier.ts').ExpectedMemoryDecision} ExpectedMemoryDecision
 * @typedef {{
 *   id: string,
 *   scope: string,
 *   expectedDecision: ExpectedMemoryDecision,
 *   expectedAction: MemoryAction | 'none',
 *   evaluationStatus?: string,
 *   evaluationReason?: string,
 *   promptVariants: string[],
 *   setup: { globalMemory: string, projectMemory: string, taskCount: number },
 *   operation?: string,
 *   stateContract?: MemoryContract,
 * }} MemoryScenario
 * @typedef {{
 *   status: number | null,
 *   stdout: string,
 *   stderr: string,
 *   kind: string,
 *   reason: unknown,
 *   completion: import('../support/types.mjs').TurnCompletion | null,
 *   prompt: string,
 * }} MemoryHostOutput
 */

const decisions = new Set(['write', 'no-write', 'proposed', 'blocked']);
const actions = new Set(['created', 'updated', 'unchanged', 'no-change', 'proposed', 'blocked']);
const contractKinds = new Set([
  'profile-create',
  'profile-update',
  'profile-forget',
  'profile-control',
  'project-input-create',
  'project-input-idempotent',
  'typed-operation',
  'typed-report',
  'no-write',
]);

/** @param {unknown} value */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value @returns {ExpectedMemoryDecision} */
function decision(value) {
  if (typeof value !== 'string' || !decisions.has(value)) {
    throw new Error('Invalid Memory scenario expectedDecision');
  }
  return /** @type {ExpectedMemoryDecision} */ (value);
}

/** @param {unknown} value @returns {MemoryAction | 'none'} */
function action(value) {
  if (value === 'none') return value;
  if (typeof value !== 'string' || !actions.has(value)) {
    throw new Error('Invalid Memory scenario expectedAction');
  }
  return /** @type {MemoryAction} */ (value);
}

/** @param {unknown} value */
function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

/** @param {string} value @returns {MemoryContract['kind']} */
function contractKind(value) {
  if (!contractKinds.has(value)) throw new Error('Invalid Memory scenario contract kind');
  return /** @type {MemoryContract['kind']} */ (value);
}

/** @param {unknown} value @returns {MemoryContract | undefined} */
function contract(value) {
  if (value === undefined) return undefined;
  const item = record(value);
  if (!item || typeof item.kind !== 'string' || !contractKinds.has(item.kind)) {
    throw new Error('Invalid Memory scenario stateContract');
  }
  for (const key of ['key', 'operation', 'trigger']) {
    if (item[key] !== undefined && typeof item[key] !== 'string') {
      throw new Error(`Invalid Memory scenario contract ${key}`);
    }
  }
  if (item.deterministic !== undefined && typeof item.deterministic !== 'boolean') {
    throw new Error('Invalid Memory scenario contract deterministic flag');
  }
  return {
    kind: contractKind(item.kind),
    key: optionalString(item.key),
    operation: optionalString(item.operation),
    trigger: optionalString(item.trigger),
    deterministic: item.deterministic,
  };
}

/**
 * @param {unknown} value
 * @param {string} scenarioId
 * @returns {MemoryScenario}
 */
export function readMemoryScenario(value, scenarioId) {
  const catalog = record(value);
  if (!catalog || !Array.isArray(catalog.scenarios)) {
    throw new Error('Invalid Memory scenario catalog');
  }
  const candidate = catalog.scenarios.map(record).find((item) => item?.id === scenarioId);
  if (!candidate) throw new Error(`Unknown memory scenario: ${scenarioId}`);
  const setup = record(candidate.setup);
  if (
    typeof candidate.scope !== 'string' ||
    !Array.isArray(candidate.promptVariants) ||
    !candidate.promptVariants.every((prompt) => typeof prompt === 'string') ||
    !setup ||
    typeof setup.globalMemory !== 'string' ||
    typeof setup.projectMemory !== 'string' ||
    !Number.isSafeInteger(setup.taskCount) ||
    Number(setup.taskCount) < 1
  ) {
    throw new Error(`Invalid Memory scenario fixture: ${scenarioId}`);
  }
  for (const key of ['evaluationStatus', 'evaluationReason', 'operation']) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
      throw new Error(`Invalid Memory scenario ${key}: ${scenarioId}`);
    }
  }
  return {
    id: scenarioId,
    scope: candidate.scope,
    expectedDecision: decision(candidate.expectedDecision),
    expectedAction: action(candidate.expectedAction),
    evaluationStatus: optionalString(candidate.evaluationStatus),
    evaluationReason: optionalString(candidate.evaluationReason),
    promptVariants: candidate.promptVariants,
    setup: {
      globalMemory: setup.globalMemory,
      projectMemory: setup.projectMemory,
      taskCount: Number(setup.taskCount),
    },
    operation: optionalString(candidate.operation),
    stateContract: contract(candidate.stateContract),
  };
}

/** @param {unknown} value @returns {value is MemoryAction} */
export function isMemoryAction(value) {
  return typeof value === 'string' && actions.has(value);
}
