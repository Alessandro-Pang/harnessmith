import { createHash } from 'node:crypto';

export type InputSource = 'chat' | 'file' | 'meeting' | 'link' | 'other';

export interface ParsedInputBody {
  content: string;
  verbatim: boolean;
}

export function normalizedInputContent(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

export function inputContentDigest(value: string, source: InputSource, verbatim: boolean): string {
  return createHash('sha256')
    .update(verbatim ? value : normalizedInputContent(value))
    .update(`\0input-source:${source}\0verbatim:${String(verbatim)}`)
    .digest('hex');
}

export function parseInputBody(body: string): ParsedInputBody | undefined {
  const match = body.match(/^\r?\n?# (原始输入|可靠摘要)\r?\n\r?\n([\s\S]*)$/);
  if (!match) return undefined;
  return { content: match[2], verbatim: match[1] === '原始输入' };
}
