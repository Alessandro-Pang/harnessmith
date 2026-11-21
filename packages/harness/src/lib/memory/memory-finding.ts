import { toSlug } from '../contract/slug.js';
import { typedContentDigest } from './memory-input.js';

export type FindingKind = 'analysis' | 'review' | 'research';
export type FindingRetention = 'workstream' | 'durable';

export function findingSlug(value: string): string {
  return toSlug(value, { fallback: 'finding' });
}

export function findingDigest(kind: FindingKind, conclusion: string): string {
  return typedContentDigest(kind, conclusion);
}

export function findingSection(body: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .match(new RegExp(`(?:^|\\n)# ${escaped}\\n\\n([\\s\\S]*?)(?=\\n# |$)`, 'u'))?.[1]
    ?.trim();
}

export function findingListSection(body: string, heading: string): string[] {
  return (findingSection(body, heading) ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}
