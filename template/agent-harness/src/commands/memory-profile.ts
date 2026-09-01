import { join } from 'node:path';
import {
  parseFrontmatter,
  parseFrontmatterDocument,
  updateFrontmatter,
} from '../lib/frontmatter.js';
import { withGlobalMemoryTransaction } from '../lib/global-memory.js';
import { readMemoryDocument } from '../lib/memory-path.js';
import {
  type MemoryWriteCandidate,
  type MemoryWriteResult,
  output,
  validateUnchanged,
  writeValidated,
} from '../lib/memory-write.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import {
  isCanonicalUserProfileRecord,
  maximumUserProfileKeyLength,
  maximumUserProfileRecords,
  parseUserProfileRecord,
  parseUserProfileRecords,
  userProfileKeyPattern,
} from '../lib/user-profile-record.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

type ProfileEvidence = 'explicit' | 'observed';
type Confidence = 'high' | 'medium' | 'low';

export interface ProfileOptions {
  key: string;
  conclusion: string;
  evidence: ProfileEvidence;
  confidence: Confidence;
  userDirected?: boolean;
  json?: boolean;
}

export interface RemoveProfileOptions {
  key: string;
  json?: boolean;
}

export interface ProfileAutopilotOptions {
  state: 'enabled' | 'paused';
  json?: boolean;
}

function assertProfileKey(key: string): void {
  if (!userProfileKeyPattern.test(key) || key.length > maximumUserProfileKeyLength) {
    throw new Error(
      'Profile key must be 1-100 characters using lowercase ASCII letters, digits, dots, or hyphens',
    );
  }
}

function profileAutopilotState(content: string): 'enabled' | 'paused' {
  const state = parseFrontmatter(content).get('profile-autopilot');
  if (state === undefined || state === 'enabled') return 'enabled';
  if (state === 'paused') return 'paused';
  throw new Error(`Invalid profile autopilot state: ${String(state)}`);
}

function profileResult(action: MemoryWriteCandidate['action'], path: string): MemoryWriteCandidate {
  return { version: 1, action, kind: 'profile', path, reference: 'memory:profile' };
}

interface ProfileForgetCandidate {
  content: string;
  removed: number;
}

function prepareProfileForgetCandidate(
  current: string,
  key: string,
  date: string,
): ProfileForgetCandidate {
  assertNoHighConfidenceSecret([current], 'User profile');
  const parsed = parseFrontmatterDocument(current);
  if (!parsed.found) throw new Error('User profile is missing YAML frontmatter');
  const records = parseUserProfileRecords(parsed.body);
  const removableLines = new Set(
    records
      .filter((record) => record.key === key && isCanonicalUserProfileRecord(record))
      .map((record) => record.lineIndex),
  );
  if (removableLines.size === 0) return { content: current, removed: 0 };
  const body = `${parsed.body
    .split(/\r?\n/)
    .filter((_, index) => !removableLines.has(index))
    .join('\n')
    .replace(/\n+$/, '')}\n`;
  const prefix = current.slice(0, current.length - parsed.body.length);
  return {
    content: updateFrontmatter(`${prefix}${body}`, { updated: date }),
    removed: removableLines.size,
  };
}

export function reconcileProfile(
  runtime: Runtime,
  options: ProfileOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret(
    [options.key, options.conclusion, options.evidence, options.confidence],
    'User profile',
  );
  assertProfileKey(options.key);
  const conclusion = options.conclusion.trim();
  if (
    !conclusion ||
    conclusion.length > 200 ||
    conclusion.includes('|') ||
    /[\r\n]/.test(conclusion)
  ) {
    throw new Error('Profile conclusion must be a single line with 1-200 characters and no pipe');
  }
  if (!['explicit', 'observed'].includes(options.evidence)) {
    throw new Error('Automatic profile reconciliation accepts only explicit or observed evidence');
  }
  if (!['high', 'medium', 'low'].includes(options.confidence)) {
    throw new Error(`Invalid profile confidence: ${options.confidence}`);
  }
  if (options.evidence !== 'explicit' || options.confidence !== 'high') {
    throw new Error(
      'Automatic profile reconciliation requires explicit evidence with high confidence',
    );
  }
  const date = calendarDate(runtime);
  const path = join(runtime.memoryHome, 'profile.md');
  const result = withGlobalMemoryTransaction(runtime, () => {
    const current = readMemoryDocument(path);
    if (profileAutopilotState(current) === 'paused' && !options.userDirected) {
      throw new Error('User profile autopilot is paused');
    }
    const semanticEntry = `- ${options.key} | ${conclusion} | ${options.evidence} | ${options.confidence}`;
    const entry = `${semanticEntry} | ${date}`;
    const parsed = parseFrontmatterDocument(current);
    const bodyLines = parsed.body.split(/\r?\n/);
    const existingRecord = bodyLines
      .map((line, index) => ({ index, record: parseUserProfileRecord(line, index) }))
      .find(({ record }) => record?.key === options.key);
    const index = existingRecord?.index ?? -1;
    const existingSemanticEntry = existingRecord?.record?.semanticEntry;
    const action =
      index < 0 ? 'created' : existingSemanticEntry === semanticEntry ? 'unchanged' : 'updated';
    if (action !== 'unchanged') {
      if (index < 0) {
        const entryCount = parseUserProfileRecords(parseFrontmatterDocument(current).body).length;
        if (entryCount >= maximumUserProfileRecords) {
          throw new Error('User profile capacity is 32 active entries; remove one before adding');
        }
        bodyLines.push(entry);
      } else bodyLines[index] = entry;
      const prefix = current.slice(0, current.length - parsed.body.length);
      const content = updateFrontmatter(`${prefix}${bodyLines.join('\n').replace(/\n+$/, '')}\n`, {
        updated: date,
      });
      writeValidated(runtime.memoryHome, [{ path, content }], io, { rootKind: 'global' });
    } else validateUnchanged(runtime.memoryHome, io, { rootKind: 'global' });
    return profileResult(action, path);
  });
  return output(result, Boolean(options.json), io);
}

export function setProfileAutopilot(
  runtime: Runtime,
  options: ProfileAutopilotOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([options.state], 'User profile autopilot request');
  if (!['enabled', 'paused'].includes(options.state)) {
    throw new Error(`Invalid profile autopilot state: ${options.state}`);
  }
  const date = calendarDate(runtime);
  const path = join(runtime.memoryHome, 'profile.md');
  const result = withGlobalMemoryTransaction(runtime, () => {
    const current = readMemoryDocument(path);
    const action = profileAutopilotState(current) === options.state ? 'unchanged' : 'updated';
    if (action !== 'unchanged') {
      const content = updateFrontmatter(current, {
        'profile-autopilot': options.state,
        updated: date,
      });
      writeValidated(runtime.memoryHome, [{ path, content }], io, { rootKind: 'global' });
    } else validateUnchanged(runtime.memoryHome, io, { rootKind: 'global' });
    return profileResult(action, path);
  });
  return output(result, Boolean(options.json), io);
}

export function removeProfileEntry(
  runtime: Runtime,
  options: RemoveProfileOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([options.key], 'User profile forget request');
  assertProfileKey(options.key);
  const date = calendarDate(runtime);
  const path = join(runtime.memoryHome, 'profile.md');
  let prepared: ProfileForgetCandidate | undefined;
  const result = withGlobalMemoryTransaction(
    runtime,
    () => {
      if (!prepared) throw new Error('Profile forget candidate was not prepared');
      if (prepared.removed === 0) {
        return profileResult('unchanged', path);
      }
      writeValidated(runtime.memoryHome, [{ path, content: prepared.content }], io, {
        rootKind: 'global',
      });
      const persisted = parseUserProfileRecords(
        parseFrontmatterDocument(readMemoryDocument(path)).body,
      );
      if (persisted.some((record) => record.key === options.key)) {
        throw new Error(`Profile forget postcondition failed: ${options.key}`);
      }
      return profileResult('updated', path);
    },
    [],
    {
      preflightContentOverrides: () => {
        prepared = prepareProfileForgetCandidate(readMemoryDocument(path), options.key, date);
        return new Map([[path, prepared.content]]);
      },
    },
  );
  return output(result, Boolean(options.json), io);
}
