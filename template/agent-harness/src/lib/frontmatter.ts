import { parseDocument } from 'yaml';

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export type FrontmatterResult =
  | {
      found: false;
      metadata: Map<string, unknown>;
      body: string;
      document: null;
    }
  | {
      found: true;
      metadata: Map<string, unknown>;
      body: string;
      document: ReturnType<typeof parseDocument>;
    };

export function parseFrontmatterDocument(content: string): FrontmatterResult {
  const match = content.match(frontmatterPattern);
  if (!match) return { found: false, metadata: new Map(), body: content, document: null };
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) throw document.errors[0];
  const value = document.toJS();
  return {
    found: true,
    metadata: new Map(Object.entries(value && typeof value === 'object' ? value : {})),
    body: content.slice(match[0].length),
    document,
  };
}

export function parseFrontmatter(content: string): Map<string, unknown> {
  return parseFrontmatterDocument(content).metadata;
}

export function updateFrontmatter(content: string, updates: Record<string, unknown>): string {
  const parsed = parseFrontmatterDocument(content);
  if (!parsed.found) throw new Error('Memory document is missing YAML frontmatter');
  for (const [key, value] of Object.entries(updates)) parsed.document.set(key, value);
  return `---\n${parsed.document.toString()}---\n${parsed.body}`;
}
