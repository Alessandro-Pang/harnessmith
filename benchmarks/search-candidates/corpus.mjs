import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const hanRunPattern = /^\p{Script=Han}+$/u;
const tokenPattern = /\p{Script=Han}+|[\p{L}\p{N}][\p{L}\p{N}_.\-/$]*/gu;
const technicalSeparatorPattern = /[_.\-/$]+/u;
const trailingTechnicalSeparatorPattern = /[_.\-/$]+$/u;
const chineseSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const maximumChunkCharacters = 16_000;

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const docsRoot = join(repositoryRoot, 'template', 'agent-harness', 'docs');
export const fieldBoosts = { aliases: 10, title: 8, headings: 5, path: 2, body: 1 };
export const indexedFields = ['aliases', 'title', 'headings', 'path', 'body'];

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalized(value) {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function normalizedToken(value) {
  return normalized(value).replace(trailingTechnicalSeparatorPattern, '');
}

function camelCaseParts(value) {
  return value
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .split(technicalSeparatorPattern)
    .flatMap((part) => part.split(/\s+/u))
    .filter(Boolean)
    .map(normalized);
}

function tokenizeHan(run) {
  const result = [];
  for (const segment of chineseSegmenter.segment(run)) {
    if (segment.isWordLike) result.push(normalized(segment.segment));
  }
  const expanded = new Set(result);
  const characters = Array.from(run, normalized);
  for (let index = 0; index < characters.length - 1; index += 1) {
    const bigram = `${characters[index]}${characters[index + 1]}`;
    if (!expanded.has(bigram)) {
      expanded.add(bigram);
      result.push(bigram);
    }
  }
  if (characters.length === 1 && !expanded.has(characters[0])) result.push(characters[0]);
  return result;
}

export function tokenizeSearchText(text) {
  const tokens = [];
  for (const match of text.normalize('NFKC').matchAll(tokenPattern)) {
    const raw = match[0];
    if (hanRunPattern.test(raw)) {
      tokens.push(...tokenizeHan(raw));
      continue;
    }
    const whole = normalizedToken(raw);
    if (whole) tokens.push(whole);
    for (const part of camelCaseParts(raw)) {
      if (part !== whole) tokens.push(part);
    }
  }
  return tokens;
}

export function tokenizeTechnicalSearchText(text) {
  const tokens = [];
  for (const match of text.normalize('NFKC').matchAll(tokenPattern)) {
    const raw = match[0];
    if (hanRunPattern.test(raw)) {
      tokens.push(...tokenizeHan(raw));
    } else {
      const token = normalizedToken(raw);
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

export function fuzzyDistance(term) {
  return /^[a-z0-9]+$/u.test(term) && term.length >= 5 ? 1 : false;
}

export function prefixTerm(term, index, terms) {
  if (index !== terms.length - 1) return false;
  return hanRunPattern.test(term) ? Array.from(term).length >= 2 : term.length >= 3;
}

export function isTechnicalQuery(query) {
  return /[_.\-/$]/u.test(query) || /\p{Ll}\p{Lu}/u.test(query);
}

function sourceFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && ['.md', '.yaml', '.yml'].includes(extname(entry.name))) result.push(path);
    }
  };
  visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

function frontmatter(content) {
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== '---') return { metadata: {}, body: content };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { metadata: {}, body: content };
  return {
    metadata: parseYaml(lines.slice(1, end).join('\n')) || {},
    body: lines.slice(end + 1).join('\n'),
  };
}

function stringList(value) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function splitBody(body) {
  if (body.length <= maximumChunkCharacters) return [body];
  const result = [];
  for (let offset = 0; offset < body.length; offset += maximumChunkCharacters) {
    result.push(body.slice(offset, offset + maximumChunkCharacters));
  }
  return result;
}

function markdownChunks(path, content) {
  const { metadata, body } = frontmatter(content);
  const lines = body.split(/\r?\n/u);
  const headings = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (match) headings.push({ depth: match[1].length, line: index, text: match[2].trim() });
  }
  const title =
    (typeof metadata.title === 'string' && metadata.title.trim()) ||
    headings.find(({ depth }) => depth === 1)?.text ||
    basename(path, extname(path));
  const aliases = [
    ...stringList(metadata.aliases),
    ...stringList(metadata.alias),
    ...stringList(metadata.tags),
  ].join(' ');
  const sections = [];
  if (headings.length === 0 || headings[0].line > 0) {
    sections.push({ start: 0, end: headings[0]?.line ?? lines.length, lineage: [] });
  }
  const lineage = [];
  for (const [index, heading] of headings.entries()) {
    lineage.splice(heading.depth - 1);
    lineage[heading.depth - 1] = heading.text;
    sections.push({
      start: heading.line,
      end: headings[index + 1]?.line ?? lines.length,
      lineage: lineage.filter(Boolean),
    });
  }
  return sections.flatMap((section) =>
    splitBody(lines.slice(section.start, section.end).join('\n'))
      .filter((sectionBody) => sectionBody.trim())
      .map((sectionBody) => ({
        sourcePath: path,
        title,
        aliases,
        headings: section.lineage.join(' > '),
        path,
        body: sectionBody,
      })),
  );
}

export function loadHarnessCorpus(size) {
  const files = sourceFiles(docsRoot).map((absolutePath) => ({
    path: relative(docsRoot, absolutePath).replaceAll('\\', '/'),
    content: readFileSync(absolutePath, 'utf8'),
  }));
  const sourceDigest = digest(
    files.map(({ path, content }) => `${path}\0${digest(content)}`).join('\n'),
  );
  const baseChunks = files.flatMap(({ path, content }) =>
    extname(path) === '.md'
      ? markdownChunks(path, content)
      : [{ sourcePath: path, title: basename(path, extname(path)), aliases: '', headings: '', path, body: content }],
  );
  const documents = Array.from({ length: size }, (_, index) => {
    const chunk = baseChunks[index % baseChunks.length];
    const replica = Math.floor(index / baseChunks.length);
    return {
      ...chunk,
      id: `chunk-${String(index).padStart(6, '0')}`,
      path: `replica-${String(replica).padStart(4, '0')}/${chunk.path}`,
      body: `${chunk.body}\n\nbenchmark-replica-${index}`,
    };
  });
  return {
    files: files.length,
    baseChunks: baseChunks.length,
    sourceDigest,
    corpusDigest: digest(JSON.stringify(documents)),
    construction:
      'Sorted public template/agent-harness/docs Markdown/YAML; split by Markdown heading and 16k characters; deterministically cycle real chunks with stable replica ids.',
    documents,
  };
}

export function loadQueries() {
  const value = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));
  return { ...value, digest: digest(JSON.stringify(value)) };
}
