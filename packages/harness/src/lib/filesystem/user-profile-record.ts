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
  const [, indentation, marker, spacing, payload] = listLike;
  const parsed = payload.match(profileRecordPayloadPattern);
  const record: UserProfileRecord = {
    line,
    lineIndex,
    canonicalMarker: indentation === '' && marker === '-' && spacing === ' ',
    key: payload.match(profileRecordKeyPattern)?.[1],
  };
  if (!parsed) return record;
  const [, key, conclusion, evidence, confidence, date] = parsed;
  return {
    ...record,
    key,
    conclusion,
    evidence: evidence as UserProfileRecord['evidence'],
    confidence: confidence as UserProfileRecord['confidence'],
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

function validCalendarDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isCanonicalUserProfileRecord(record: UserProfileRecord): boolean {
  return (
    record.canonicalMarker &&
    record.semanticEntry !== undefined &&
    record.key !== undefined &&
    record.key.length <= maximumUserProfileKeyLength &&
    validCalendarDate(record.date)
  );
}
