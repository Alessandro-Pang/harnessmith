import { parseDocument } from 'yaml';

export function parseFrontmatter(content: string): Map<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return new Map();
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) throw document.errors[0];
  const value = document.toJS();
  return new Map(Object.entries(value && typeof value === 'object' ? value : {}));
}

export function updateFrontmatter(content: string, updates: Record<string, unknown>): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Memory document is missing YAML frontmatter');
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) throw document.errors[0];
  for (const [key, value] of Object.entries(updates)) document.set(key, value);
  const body = content.slice(match[0].length);
  return `---\n${document.toString()}---\n${body}`;
}
