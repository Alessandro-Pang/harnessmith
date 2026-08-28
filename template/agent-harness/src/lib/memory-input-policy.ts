import { readBoundedRegularFile } from './bounded-file.js';

type InputMode = 'verbatim' | 'summary';
type InputPurpose = 'constraint' | 'acceptance' | 'source' | 'risk-decision' | 'explicit-retain';
type InputRetention = 'workstream' | 'durable';

export interface InputOptions {
  title: string;
  content?: string;
  contentFile?: string;
  source: 'chat' | 'file' | 'meeting' | 'link' | 'other';
  mode?: InputMode;
  /** @deprecated Internal compatibility only; CLI callers must provide mode. */
  summary?: boolean;
  purpose?: InputPurpose;
  retention?: InputRetention;
  workstream?: string;
  scope?: string[];
  sourceRefs?: string[];
  json?: boolean;
}

export interface ResolvedInputPolicy {
  mode: InputMode;
  purpose: InputPurpose;
  retention: InputRetention;
  workstream?: string;
}

export const maximumInputContentBytes = 1024 * 1024;
const inputModes = new Set<InputMode>(['verbatim', 'summary']);
const inputPurposes = new Set<InputPurpose>([
  'constraint',
  'acceptance',
  'source',
  'risk-decision',
  'explicit-retain',
]);
const inputRetentions = new Set<InputRetention>(['workstream', 'durable']);

export function singleLine(value: string | undefined, subject: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new Error(`${subject} must be a non-empty single line`);
  }
  return normalized;
}

export function inputPayload(options: InputOptions): string {
  const hasContent = options.content !== undefined;
  const hasContentFile = options.contentFile !== undefined;
  if (hasContent === hasContentFile) {
    throw new Error('Input capture requires exactly one of content or contentFile');
  }
  if (hasContent) return options.content as string;
  if (!options.contentFile?.trim()) {
    throw new Error('Input capture requires a non-empty contentFile path');
  }
  return readBoundedRegularFile(options.contentFile, {
    maxBytes: maximumInputContentBytes,
    subject: 'Input contentFile',
  }).content;
}

export function resolveInputPolicy(options: InputOptions): ResolvedInputPolicy {
  const mode = options.mode ?? (options.summary ? 'summary' : 'verbatim');
  const purpose = options.purpose ?? 'explicit-retain';
  const retention = options.retention ?? 'durable';
  if (!inputModes.has(mode)) {
    throw new Error('Input mode is required and must be verbatim or summary');
  }
  if (!inputPurposes.has(purpose)) {
    throw new Error(
      'Input purpose is required and must be constraint, acceptance, source, risk-decision, or explicit-retain',
    );
  }
  if (!inputRetentions.has(retention)) {
    throw new Error('Input retention is required and must be workstream or durable');
  }
  const workstream = singleLine(options.workstream, 'Input workstream');
  if (retention === 'workstream' && !workstream) {
    throw new Error('Input workstream is required for workstream retention');
  }
  if (retention === 'durable' && workstream !== undefined) {
    throw new Error('Durable input must not declare a workstream');
  }
  return { mode, purpose, retention, workstream };
}
