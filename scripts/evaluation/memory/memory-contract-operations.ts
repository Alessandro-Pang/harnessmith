import type { MemoryContractResult, MemoryContractState } from './memory-contract-verifier.js';

const result = (
  outcome: MemoryContractResult['outcome'],
  ...reasons: string[]
): MemoryContractResult => ({ outcome, reasons });
const equal = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key]);
};
const changed = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  !equal(a, b);
function metadata(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const front = content.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? '';
  for (const line of front.split(/\r?\n/u)) {
    const match = /^([a-z0-9-]+):\s*(.*?)\s*$/u.exec(line);
    if (match) map.set(match[1], match[2].replace(/^['"]|['"]$/gu, ''));
  }
  return map;
}
function projectMarkdown(
  files: Readonly<Record<string, string>>,
): Array<[string, Map<string, string>]> {
  return Object.entries(files)
    .filter(([path, _value]) => path.endsWith('.md'))
    .map(([path, value]) => [path, metadata(value)]);
}
function captureCheck(
  operation: string,
  docs: Array<[string, Map<string, string>]>,
): MemoryContractResult | null {
  const wanted =
    operation === 'capture-finding'
      ? ['analytical-finding', 'working', 'distilled']
      : ['operational-experience', 'distilled'];
  const valid = docs.some(
    ([, meta]) =>
      meta.get('type') === wanted[0] &&
      (operation === 'capture-finding'
        ? wanted.slice(1).includes(meta.get('memory-kind') ?? '') && meta.has('finding-digest')
        : meta.get('memory-kind') === wanted[1]) &&
      meta.has('source-refs'),
  );
  return valid
    ? null
    : result('failed', `${operation} missing typed metadata, digest, or source references`);
}
function closeInputCheck(
  before: Array<[string, Map<string, string>]>,
  after: Array<[string, Map<string, string>]>,
): MemoryContractResult | null {
  const valid = after.some(
    ([path, meta]) =>
      meta.get('memory-kind') === 'input' &&
      meta.get('status') === 'complete' &&
      before.some(
        ([old, oldMeta]) =>
          old === path && ['active', 'blocked'].includes(oldMeta.get('status') ?? ''),
      ),
  );
  return valid
    ? null
    : result('failed', 'close-input did not transition an existing input to complete');
}
function archiveCheck(
  before: Array<[string, Map<string, string>]>,
  after: Array<[string, Map<string, string>]>,
): MemoryContractResult | null {
  const archived = after.some(
    ([path, meta]) => path.includes('/_archive/') && meta.get('status') === 'archived',
  );
  const removed = before.some(
    ([path]) =>
      path.endsWith('.md') &&
      !path.includes('/_archive/') &&
      !after.some(([next]) => next === path),
  );
  return archived && removed
    ? null
    : result('failed', 'archive did not move a source memory into _archive with archived status');
}
function supersedeCheck(after: Array<[string, Map<string, string>]>): MemoryContractResult | null {
  const item = after.find(
    ([, meta]) =>
      meta.get('status') === 'superseded' &&
      (meta.get('superseded-by') ?? '').startsWith('memory:'),
  );
  const ref = item?.[1].get('superseded-by')?.slice('memory:'.length);
  return item && ref && after.some(([path]) => path.endsWith(`/${ref}`) || path === ref)
    ? null
    : result('failed', 'supersede target or relation is missing');
}
function handoffCheck(
  operation: string,
  before: Array<[string, Map<string, string>]>,
  after: Array<[string, Map<string, string>]>,
): MemoryContractResult | null {
  const item = after.find(([, meta]) => meta.get('type') === 'session-handoff');
  const prior = item && before.find(([path]) => path === item[0]);
  const status = item?.[1].get('status');
  if (!item) return result('failed', `${operation} has no session-handoff document`);
  if (operation === 'handoff' && !['active', 'blocked'].includes(status ?? ''))
    return result('failed', 'handoff did not produce active/blocked state');
  return operation === 'close-handoff' &&
    (!prior ||
      !['active', 'blocked'].includes(prior[1].get('status') ?? '') ||
      status !== 'complete')
    ? result('failed', 'close-handoff did not transition active/blocked to complete')
    : null;
}
export function operationStateCheck(
  operation: string,
  before: MemoryContractState,
  after: MemoryContractState,
): MemoryContractResult | null {
  const b = projectMarkdown(before.project);
  const a = projectMarkdown(after.project);
  if (changed(before.global, after.global))
    return result('failed', `operation ${operation} changed global profile scope`);
  if (operation === 'capture-finding' || operation === 'capture-experience')
    return captureCheck(operation, a);
  if (operation === 'capture-input') {
    const valid = a.some(
      ([path, meta]) =>
        meta.get('memory-kind') === 'input' &&
        ['active', 'blocked'].includes(meta.get('status') ?? '') &&
        !b.some(([oldPath]) => oldPath === path),
    );
    return valid
      ? null
      : result('failed', 'capture-input did not create a typed active/blocked input');
  }
  if (operation === 'close-input') return closeInputCheck(b, a);
  if (operation === 'archive') return archiveCheck(b, a);
  if (operation === 'supersede') return supersedeCheck(a);
  if (operation === 'handoff' || operation === 'close-handoff')
    return handoffCheck(operation, b, a);
  if (operation === 'migrate') return migrateCheck(b, a);
  if (operation === 'curation-apply') {
    if (!closeInputCheck(b, a) || !archiveCheck(b, a)) return null;
    return curationApplyFallback();
  }
  return null;
}

function migrateCheck(
  before: Array<[string, Map<string, string>]>,
  after: Array<[string, Map<string, string>]>,
): MemoryContractResult | null {
  const beforeMap = new Map(before);
  const afterMap = new Map(after);
  if (beforeMap.size !== afterMap.size)
    return result('failed', 'migrate changed the project document set');
  const changedPaths = [...afterMap.keys()].filter((path) => {
    const prior = beforeMap.get(path);
    const next = afterMap.get(path);
    if (!prior || !next) return true;
    return [...next.entries()].some(([key, value]) => prior.get(key) !== value);
  });
  if (changedPaths.length !== 1)
    return result('failed', 'migrate must change metadata on exactly one document');
  const path = changedPaths[0];
  const prior = beforeMap.get(path);
  const next = afterMap.get(path);
  if (!prior || !next) return result('failed', 'migrate target disappeared');
  const material = [...next.entries()].some(
    ([key, value]) => key !== 'updated' && prior.get(key) !== value,
  );
  return material ? null : result('failed', 'migrate did not change targeted metadata');
}

function curationApplyFallback(): MemoryContractResult {
  return result('failed', 'curation-apply did not close an input or archive a memory');
}

function reportTriggerPresent(after: MemoryContractState, trigger: string | undefined): boolean {
  if (trigger === 'active-input') {
    return Object.values(after.project).some(
      (content) => /memory-kind:\s*input/u.test(content) && /status:\s*active/u.test(content),
    );
  }
  if (trigger === 'missing-readme') return after.project['README.md'] === undefined;
  if (trigger === 'curation-candidate') {
    return Object.values(after.project).some(
      (content) =>
        /memory-kind:\s*input/u.test(content) &&
        /retention:\s*workstream/u.test(content) &&
        /status:\s*active/u.test(content),
    );
  }
  return false;
}

export function typedReportCheck(
  contract: { operation?: string; trigger?: string },
  before: MemoryContractState,
  after: MemoryContractState,
): MemoryContractResult {
  if (!equal(before.global, after.global) || !equal(before.project, after.project)) {
    return result(
      'failed',
      `report-only ${contract.operation ?? 'operation'} changed durable state`,
    );
  }
  if (!reportTriggerPresent(after, contract.trigger)) {
    return result(
      'failed',
      `report-only ${contract.operation ?? 'operation'} removed its seeded trigger`,
    );
  }
  return result('passed');
}
