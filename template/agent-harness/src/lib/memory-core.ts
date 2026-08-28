import { posix } from 'node:path';
import { updateFrontmatter } from './frontmatter.js';
import { isAtxHeading, parseAtxHeading } from './markdown-heading.js';
import { contentMemoryReferences } from './memory-validation.js';

export type MemoryCoreSection =
  | 'Active Work'
  | 'Important Inputs'
  | 'Distilled Memory'
  | 'Recent Handoffs'
  | 'User Profile';

export function escapeCoreLabel(value: string): string {
  return value.replaceAll('memory:', 'memory&#58;');
}

const placeholders: Partial<Record<MemoryCoreSection, string>> = {
  'Important Inputs': '- <输入来源与适用范围；创建后补充 memory 引用>',
  'Recent Handoffs': '- <会话目标与未完成边界；创建后补充 memory 引用>',
};

function sectionBounds(
  lines: string[],
  section: MemoryCoreSection,
): { index: number; end: number } {
  const heading = `## ${section}`;
  const indexes = lines.flatMap((line, index) => (isAtxHeading(line, 2, section) ? [index] : []));
  if (indexes.length !== 1) {
    throw new Error(`Memory core section must appear exactly once: ${section}`);
  }
  const [index] = indexes;
  if (lines[index] !== heading) {
    throw new Error(`Memory core section must use its canonical heading: ${section}`);
  }
  const nextHeader = lines.findIndex(
    (line, lineIndex) => lineIndex > index && parseAtxHeading(line)?.level === 2,
  );
  return { index, end: nextHeader < 0 ? lines.length : nextHeader };
}

function compactSection(lines: string[]): string[] {
  const compact: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !compact.at(-1)?.trim()) continue;
    compact.push(line);
  }
  while (compact.at(-1)?.trim() === '') compact.pop();
  return compact;
}

export function sameMemoryReference(candidate: string, expected: string): boolean {
  const normalize = (value: string) =>
    posix.normalize(value.replace(/\.md$/, '')).replace(/^\.\//, '').toLowerCase();
  return normalize(candidate) === normalize(expected);
}

export function upsertCoreReference(
  content: string,
  section: MemoryCoreSection,
  entry: string,
  reference: string,
  updated: string,
): string {
  if (!entry.trim() || /[\r\n]/.test(entry)) {
    throw new Error('Memory core entry must be a single line');
  }
  const lines = content.split(/\r?\n/);
  const { index, end } = sectionBounds(lines, section);
  const sectionLines = lines.slice(index + 1, end);
  const referencePath = reference.replace(/^memory:/, '');
  const matchingReferences = sectionLines
    .flatMap((line) => contentMemoryReferences(line))
    .filter((candidate) => sameMemoryReference(candidate, referencePath));
  if (matchingReferences.length > 1) {
    throw new Error(`Ambiguous memory core reference: ${reference}`);
  }
  const matchingLines = sectionLines.filter((line) =>
    contentMemoryReferences(line).some((candidate) =>
      sameMemoryReference(candidate, referencePath),
    ),
  );
  const placeholder = placeholders[section];
  if (
    matchingLines.length === 1 &&
    matchingLines[0] === entry &&
    (!placeholder || !sectionLines.includes(placeholder))
  ) {
    return content;
  }
  const retainedLines: string[] = [];
  for (const line of lines.slice(index + 1, end)) {
    const references = contentMemoryReferences(line);
    const matches = references.filter((candidate) => sameMemoryReference(candidate, referencePath));
    if (matches.length === 0) {
      retainedLines.push(line);
      continue;
    }
    const otherReferences = references.filter(
      (candidate) => !sameMemoryReference(candidate, referencePath),
    );
    if (otherReferences.length === 0) continue;
    let retained = line;
    for (const candidate of matches) retained = retained.replace(`memory:${candidate}`, '');
    retainedLines.push(retained.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }
  const retained = compactSection(retainedLines.filter((line) => line.trim() !== placeholder));
  lines.splice(index + 1, end - index - 1, '', entry, ...retained, '');
  return updateFrontmatter(`${lines.join('\n').replace(/\n+$/, '')}\n`, { updated });
}

export function removeCoreReference(
  content: string,
  section: MemoryCoreSection,
  reference: string,
  updated: string,
): string {
  const lines = content.split(/\r?\n/);
  const { index, end } = sectionBounds(lines, section);
  const expected = reference.replace(/^memory:/, '');
  const matchingReferences = lines
    .slice(index + 1, end)
    .flatMap((line) => contentMemoryReferences(line))
    .filter((candidate) => sameMemoryReference(candidate, expected));
  if (matchingReferences.length > 1) {
    throw new Error(`Ambiguous memory core reference: ${reference}`);
  }
  let changed = false;
  const retained: string[] = [];
  for (const line of lines.slice(index + 1, end)) {
    const references = contentMemoryReferences(line);
    const matches = references.filter((candidate) => sameMemoryReference(candidate, expected));
    if (matches.length === 0) {
      retained.push(line);
      continue;
    }
    changed = true;
    const otherReferences = references.filter(
      (candidate) => !sameMemoryReference(candidate, expected),
    );
    if (otherReferences.length === 0) continue;
    let next = line;
    for (const candidate of matches) next = next.replace(`memory:${candidate}`, '');
    retained.push(next.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }
  if (!changed) return content;
  lines.splice(index + 1, end - index - 1, ...compactSection(retained));
  return updateFrontmatter(`${lines.join('\n').replace(/\n+$/, '')}\n`, { updated });
}
