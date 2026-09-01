import { createHash } from 'node:crypto';
import { normalizedInputContent } from './memory-input.js';

export type FindingKind = 'analysis' | 'review' | 'research';
export type FindingRetention = 'workstream' | 'durable';

export function findingSlug(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'finding'
  );
}

export function findingDigest(kind: FindingKind, conclusion: string): string {
  return createHash('sha256')
    .update(`${kind}\0${normalizedInputContent(conclusion)}`)
    .digest('hex');
}

export function findingSection(body: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .match(new RegExp(`(?:^|\\n)# ${escaped}\\n\\n([\\s\\S]*?)(?=\\n# |$)`, 'u'))?.[1]
    .trim();
}
