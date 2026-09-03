import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseFrontmatterDocument } from '../documentation/frontmatter.js';

const maxChunkCharacters = 16_000;

interface PositionedNode {
  type?: string;
  depth?: number;
  value?: string;
  children?: PositionedNode[];
  position?: { start: { line: number }; end: { line: number } };
}

interface Heading {
  depth: number;
  line: number;
  text: string;
  lineage: string[];
  occurrence: number;
}

export interface SearchChunk {
  id: string;
  title: string;
  aliases: string;
  headings: string;
  path: string;
  body: string;
  lineStart: number;
  lineEnd: number;
}

interface ChunkInput {
  content: string;
  relativePath: string;
  sourceIndex: number;
}

function nodeText(node: PositionedNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children || []).map(nodeText).join('');
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function chunkId(
  sourceIndex: number,
  relativePath: string,
  lineage: string[],
  occurrence: number,
  splitOrdinal: number,
): string {
  return digest(JSON.stringify([sourceIndex, relativePath, lineage, occurrence, splitOrdinal]));
}

function splitSection(
  lines: string[],
): Array<{ body: string; lineStart: number; lineEnd: number; ordinal: number }> {
  const chunks: Array<{ body: string; lineStart: number; lineEnd: number; ordinal: number }> = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentLength = 0;
  const flush = (lineEnd: number): void => {
    if (current.length === 0) return;
    chunks.push({
      body: current.join('\n'),
      lineStart: currentStart,
      lineEnd,
      ordinal: chunks.length,
    });
    current = [];
    currentLength = 0;
  };
  for (const [lineIndex, line] of lines.entries()) {
    if (line.length > maxChunkCharacters) {
      flush(lineIndex - 1);
      for (let offset = 0; offset < line.length; offset += maxChunkCharacters) {
        chunks.push({
          body: line.slice(offset, offset + maxChunkCharacters),
          lineStart: lineIndex,
          lineEnd: lineIndex,
          ordinal: chunks.length,
        });
      }
      continue;
    }
    const candidateLength = currentLength + (current.length > 0 ? 1 : 0) + line.length;
    if (current.length > 0 && candidateLength > maxChunkCharacters) flush(lineIndex - 1);
    if (current.length === 0) currentStart = lineIndex;
    current.push(line);
    currentLength = current.length === 1 ? line.length : candidateLength;
  }
  flush(lines.length - 1);
  return chunks;
}

function titleFromPath(path: string): string {
  const extension = extname(path);
  return basename(path, extension);
}

function yamlChunks(input: ChunkInput): SearchChunk[] {
  const lines = input.content.split(/\r?\n/u);
  const title = titleFromPath(input.relativePath);
  return splitSection(lines)
    .filter(({ body }) => body.trim().length > 0)
    .map((chunk) => ({
      id: chunkId(input.sourceIndex, input.relativePath, [], 0, chunk.ordinal),
      title,
      aliases: '',
      headings: '',
      path: input.relativePath,
      body: chunk.body,
      lineStart: chunk.lineStart + 1,
      lineEnd: chunk.lineEnd + 1,
    }));
}

function markdownChunks(input: ChunkInput): SearchChunk[] {
  const frontmatter = parseFrontmatterDocument(input.content);
  const prefix = input.content.slice(0, input.content.length - frontmatter.body.length);
  const bodyLineOffset = prefix.match(/\r?\n/gu)?.length || 0;
  const bodyLines = frontmatter.body.split(/\r?\n/u);
  const root = fromMarkdown(frontmatter.body) as PositionedNode;
  const rawHeadings = (root.children || [])
    .filter(
      (
        node,
      ): node is PositionedNode & {
        depth: number;
        position: NonNullable<PositionedNode['position']>;
      } => node.type === 'heading' && typeof node.depth === 'number' && node.position !== undefined,
    )
    .map((node) => ({ depth: node.depth, line: node.position.start.line, text: nodeText(node) }));
  const lineage: string[] = [];
  const occurrences = new Map<string, number>();
  const headings: Heading[] = rawHeadings.map((heading) => {
    lineage.splice(heading.depth - 1);
    lineage[heading.depth - 1] = heading.text;
    const currentLineage = lineage.filter(Boolean);
    const key = JSON.stringify(currentLineage);
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    return { ...heading, lineage: [...currentLineage], occurrence };
  });
  const configuredTitle = frontmatter.metadata.get('title');
  const title =
    (typeof configuredTitle === 'string' && configuredTitle.trim()) ||
    headings.find((heading) => heading.depth === 1)?.text ||
    titleFromPath(input.relativePath);
  const aliases = [
    ...stringList(frontmatter.metadata.get('aliases')),
    ...stringList(frontmatter.metadata.get('alias')),
    ...stringList(frontmatter.metadata.get('tags')),
  ].join(' ');
  const sections: Array<{
    start: number;
    end: number;
    lineage: string[];
    occurrence: number;
  }> = [];
  if (headings[0]?.line !== 1) {
    sections.push({
      start: 1,
      end: (headings[0]?.line || bodyLines.length + 1) - 1,
      lineage: [],
      occurrence: 0,
    });
  }
  for (const [index, heading] of headings.entries()) {
    sections.push({
      start: heading.line,
      end: (headings[index + 1]?.line || bodyLines.length + 1) - 1,
      lineage: heading.lineage,
      occurrence: heading.occurrence,
    });
  }
  const result: SearchChunk[] = [];
  for (const section of sections) {
    const sectionLines = bodyLines.slice(section.start - 1, section.end);
    for (const split of splitSection(sectionLines)) {
      if (!split.body.trim()) continue;
      result.push({
        id: chunkId(
          input.sourceIndex,
          input.relativePath,
          section.lineage,
          section.occurrence,
          split.ordinal,
        ),
        title,
        aliases,
        headings: section.lineage.join(' > '),
        path: input.relativePath,
        body: split.body,
        lineStart: bodyLineOffset + section.start + split.lineStart,
        lineEnd: bodyLineOffset + section.start + split.lineEnd,
      });
    }
  }
  return result;
}

export function chunkSearchDocument(input: ChunkInput): SearchChunk[] {
  const extension = extname(input.relativePath).toLocaleLowerCase('und');
  return extension === '.md' ? markdownChunks(input) : yamlChunks(input);
}
