const hanRunPattern = /^\p{Script=Han}+$/u;
const tokenPattern = /\p{Script=Han}+|[\p{L}\p{N}][\p{L}\p{N}_.\-/$]*/gu;
const technicalSeparatorPattern = /[_.\-/$]+/u;
const trailingTechnicalSeparatorPattern = /[_.\-/$]+$/u;

const chineseSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export const searchAnalyzerVersion = 2;

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function normalizedToken(value: string): string {
  return normalized(value).replace(trailingTechnicalSeparatorPattern, '');
}

function camelCaseParts(value: string): string[] {
  return value
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .split(technicalSeparatorPattern)
    .flatMap((part) => part.split(/\s+/u))
    .filter(Boolean)
    .map(normalized);
}

function tokenizeHan(run: string): string[] {
  const result: string[] = [];
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

/** Versioned, host-neutral tokenizer for indexed Harness documentation. */
export function tokenizeSearchText(text: string): string[] {
  const tokens: string[] = [];
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

/** Query tokenizer that preserves exact technical identifiers without noisy separator parts. */
export function tokenizeTechnicalSearchText(text: string): string[] {
  const tokens: string[] = [];
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

export function fuzzyDistance(term: string): number | false {
  return /^[a-z0-9]+$/u.test(term) && term.length >= 5 ? 1 : false;
}

export function prefixTerm(term: string, index: number, terms: string[]): boolean {
  if (index !== terms.length - 1) return false;
  return hanRunPattern.test(term) ? Array.from(term).length >= 2 : term.length >= 3;
}
