/** Independent semantic state oracle for Memory evaluations.
 * It consumes persisted state, never a model transcript or regex over replies.
 * Free-form conclusions require a separate semantic review artifact.
 */
export type MemoryContractKind =
  | 'profile-create'
  | 'profile-update'
  | 'profile-forget'
  | 'profile-control'
  | 'project-input-create'
  | 'project-input-idempotent'
  | 'typed-operation'
  | 'no-write';
export interface MemoryContractState {
  global: Readonly<Record<string, string>>;
  project: Readonly<Record<string, string>>;
}
export interface MemoryContract {
  kind: MemoryContractKind;
  key?: string;
  operation?: string;
  deterministic?: boolean;
}
export interface SemanticReview {
  status: 'passed' | 'failed' | 'inconclusive';
  message?: string;
}
export interface MemoryContractResult {
  outcome: 'passed' | 'failed' | 'inconclusive';
  reasons: string[];
}

const digest = (value: string) => value;
const filesEqual = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key]);
};
const changed = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  !filesEqual(a, b);

/** Parse canonical profile records from all profile.md content. Returns null on malformed/duplicate state. */
export function parseProfileRecords(
  files: Readonly<Record<string, string>>,
): Map<string, { conclusion: string; evidence: string; confidence: string }> | null {
  const profilePaths = Object.keys(files).filter(
    (path) => path === 'profile.md' || path.endsWith('/profile.md'),
  );
  const content = profilePaths.map((path) => files[path] ?? '').join('\n');
  const result = new Map<string, { conclusion: string; evidence: string; confidence: string }>();
  for (const line of content.split(/\r?\n/u)) {
    const match =
      /^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \| ([^|\r\n]{1,200}) \| (explicit|observed) \| (high|medium|low)(?: \| \d{4}-\d{2}-\d{2})?$/u.exec(
        line.trim(),
      );
    if (!match) {
      if (line.trim().startsWith('- ')) return null;
      continue;
    }
    if (result.has(match[1])) return null;
    result.set(match[1], { conclusion: match[2], evidence: match[3], confidence: match[4] });
  }
  return result;
}

function result(
  outcome: MemoryContractResult['outcome'],
  ...reasons: string[]
): MemoryContractResult {
  return { outcome, reasons };
}

import { operationStateCheck } from './memory-contract-operations.js';

function semanticGate(review: SemanticReview | undefined): MemoryContractResult | null {
  if (!review)
    return result(
      'inconclusive',
      'free-form persisted meaning lacks an independent semantic review',
    );
  if (review.status === 'failed')
    return result('failed', review.message ?? 'independent semantic review failed');
  if (review.status === 'inconclusive')
    return result('inconclusive', review.message ?? 'independent semantic review is inconclusive');
  return null;
}

function profileContractCheck(input: {
  contract: MemoryContract;
  before: MemoryContractState;
  after: MemoryContractState;
  globalBefore: NonNullable<ReturnType<typeof parseProfileRecords>>;
  globalAfter: NonNullable<ReturnType<typeof parseProfileRecords>>;
  semanticReview?: SemanticReview;
}): MemoryContractResult {
  const { contract, before, after, globalBefore, globalAfter } = input;
  if (changed(before.project, after.project))
    return result('failed', 'profile operation changed project scope');
  if (!contract.key) return result('inconclusive', 'profile contract has no stable key');
  const prior = globalBefore.get(contract.key);
  const next = globalAfter.get(contract.key);
  if (contract.kind === 'profile-create')
    return prior || !next || globalAfter.size !== globalBefore.size + 1
      ? result('failed', 'profile create did not add exactly one stable key')
      : contract.deterministic
        ? result('passed')
        : (semanticGate(input.semanticReview) ?? result('passed'));
  if (contract.kind === 'profile-update')
    return !prior ||
      !next ||
      globalAfter.size !== globalBefore.size ||
      (prior.conclusion === next.conclusion &&
        prior.evidence === next.evidence &&
        prior.confidence === next.confidence)
      ? result('failed', 'profile update did not change exactly the requested stable key')
      : contract.deterministic
        ? result('passed')
        : (semanticGate(input.semanticReview) ?? result('passed'));
  return !prior || next || globalAfter.size !== globalBefore.size - 1
    ? result('failed', 'profile forget did not remove exactly the requested key')
    : result('passed');
}
export function verifyMemoryContract(input: {
  before: MemoryContractState;
  after: MemoryContractState;
  contract?: MemoryContract;
  semanticReview?: SemanticReview;
}): MemoryContractResult {
  const contract = input.contract;
  if (!contract) return result('inconclusive', 'scenario has no typed state contract');
  if (contract.kind === 'no-write') {
    return filesEqual(input.before.global, input.after.global) &&
      filesEqual(input.before.project, input.after.project)
      ? result('passed')
      : result('failed', 'no-write contract changed global or project durable state');
  }
  const globalBefore = parseProfileRecords(input.before.global);
  const globalAfter = parseProfileRecords(input.after.global);
  if (globalBefore === null || globalAfter === null)
    return result('failed', 'profile state is malformed or contains duplicate canonical keys');
  if (contract.kind === 'profile-control') {
    if (changed(input.before.project, input.after.project))
      return result('failed', 'profile control changed project scope');
    if (globalBefore.size !== globalAfter.size)
      return result('failed', 'profile control changed profile records');
    const profileText = (files: Readonly<Record<string, string>>) =>
      Object.entries(files)
        .filter(([path]) => path === 'profile.md' || path.endsWith('/profile.md'))
        .map(([, value]) => value)
        .join('');
    const beforeProfile = profileText(input.before.global);
    const afterProfile = profileText(input.after.global);
    if (beforeProfile === afterProfile)
      return result('failed', 'profile control did not change autopilot state');
    return result('passed');
  }
  if (contract.kind === 'project-input-idempotent') {
    return filesEqual(input.before.global, input.after.global) &&
      filesEqual(input.before.project, input.after.project)
      ? result('passed')
      : result('failed', 'duplicate project input changed durable state');
  }
  if (contract.kind === 'typed-operation') {
    const mutating = new Set([
      'capture-input',
      'close-input',
      'capture-finding',
      'capture-experience',
      'handoff',
      'close-handoff',
      'supersede',
      'archive',
      'migrate',
      'curation-apply',
    ]);
    if (!contract.operation)
      return result('inconclusive', 'typed operation contract has no operation name');
    const structural = operationStateCheck(contract.operation, input.before, input.after);
    if (structural) return structural;
    if (mutating.has(contract.operation) && !changed(input.before.project, input.after.project))
      return result(
        'failed',
        `operation ${contract.operation} produced no project state transition`,
      );
    return contract.deterministic
      ? result('passed')
      : (semanticGate(input.semanticReview) ?? result('passed'));
  }
  if (
    contract.kind === 'profile-create' ||
    contract.kind === 'profile-update' ||
    contract.kind === 'profile-forget'
  )
    return profileContractCheck({
      contract,
      before: input.before,
      after: input.after,
      globalBefore,
      globalAfter,
      semanticReview: input.semanticReview,
    });
  if (contract.kind === 'project-input-create') {
    if (changed(input.before.global, input.after.global))
      return result('failed', 'project input promoted into global profile');
    if (!changed(input.before.project, input.after.project))
      return result('failed', 'project input did not create a project state transition');
    return contract.deterministic
      ? result('passed')
      : (semanticGate(input.semanticReview) ?? result('passed'));
  }
  return result('inconclusive', `unsupported contract ${digest(contract.kind)}`);
}
