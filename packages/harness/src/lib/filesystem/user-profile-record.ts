import { isValidCalendarDate } from './calendar-date.js';

export const userProfileKeyPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const maximumUserProfileKeyLength = 100;
export const maximumUserProfileRecords = 32;

const profileRecordPayloadPattern =
  /^([a-z0-9]+(?:[.-][a-z0-9]+)*) \| ([^|]{1,200}) \| (explicit|observed|inferred) \| (high|medium|low) \| (\d{4}-\d{2}-\d{2})$/;
const profileRecordKeyPattern = /^([a-z0-9]+(?:[.-][a-z0-9]+)*) \|/;
const listLikeRecordPattern = /^([\t ]*)([-+*])([\t ]+)(.*)$/;

export interface UserProfileRecord {
  line: string;
  lineIndex: number;
  canonicalMarker: boolean;
  key?: string;
  conclusion?: string;
  evidence?: 'explicit' | 'observed' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
  date?: string;
  semanticEntry?: string;
}

export function parseUserProfileRecord(line: string, lineIndex = 0): UserProfileRecord | undefined {
  const listLike = line.match(listLikeRecordPattern);
  if (!listLike) return undefined;
  const [, indentation = '', marker = '', spacing = '', payload = ''] = listLike;
  const parsed = payload.match(profileRecordPayloadPattern);
  const recordKey = payload.match(profileRecordKeyPattern)?.[1];
  const record: UserProfileRecord = {
    line,
    lineIndex,
    canonicalMarker: indentation === '' && marker === '-' && spacing === ' ',
    ...(recordKey === undefined ? {} : { key: recordKey }),
  };
  if (!parsed) return record;
  const [, key, conclusion, evidence, confidence, date] = parsed;
  if (
    key === undefined ||
    conclusion === undefined ||
    evidence === undefined ||
    confidence === undefined ||
    date === undefined
  ) {
    return record;
  }
  return {
    ...record,
    key,
    conclusion,
    evidence: evidence as NonNullable<UserProfileRecord['evidence']>,
    confidence: confidence as NonNullable<UserProfileRecord['confidence']>,
    date,
    semanticEntry: `- ${key} | ${conclusion} | ${evidence} | ${confidence}`,
  };
}

export function parseUserProfileRecords(content: string): UserProfileRecord[] {
  const records: UserProfileRecord[] = [];
  for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
    const record = parseUserProfileRecord(line, lineIndex);
    if (record) records.push(record);
  }
  return records;
}

export function isCanonicalUserProfileRecord(record: UserProfileRecord): boolean {
  return (
    record.canonicalMarker &&
    record.semanticEntry !== undefined &&
    record.key !== undefined &&
    record.key.length <= maximumUserProfileKeyLength &&
    isValidCalendarDate(record.date)
  );
}
