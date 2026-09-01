export interface PlaybookAliasEvidence {
  mentioned: boolean;
  negated: boolean;
  requested: boolean;
}

export function normalizeRoutingText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routingMatchPositions(candidate: string, term: string): number[] {
  if (/\p{Script=Han}/u.test(candidate)) {
    const positions: number[] = [];
    let offset = 0;
    while (offset <= term.length - candidate.length) {
      const position = term.indexOf(candidate, offset);
      if (position === -1) break;
      positions.push(position);
      offset = position + candidate.length;
    }
    return positions;
  }
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${escapeRegularExpression(candidate)})(?=$|[^\\p{L}\\p{N}])`,
    'gu',
  );
  return [...term.matchAll(pattern)].map(
    (match) => (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0),
  );
}

function routingMatchIsNegated(term: string, position: number): boolean {
  const clause =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1) ?? '';
  return /(?:\b(?:do\s+not|don't|not|never|without|no)\s+(?:\p{L}+\s+){0,2}|(?:不要|无需|不必|别|禁止|避免|不)\s*)$/u.test(
    clause,
  );
}

function routingMatchIsRequestedAction(term: string, position: number): boolean {
  const clause =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1) ?? '';
  const prefix = clause.trim();
  if (prefix === '') return true;
  return /^(?:(?:please|can you|could you|would you|i want you to|i need you to|let(?:'s| us)|now|then|also)(?:\s+\p{L}+){0,4}|(?:(?:请你?|帮我|给我|现在|继续|重新|开始|进行|执行|来|需要|要求|希望|想要|逐个|并|只)\s*)+|(?:结合|基于|根据)[\p{L}\p{N} ._-]{0,40}(?:来)?)$/u.test(
    prefix,
  );
}

function routingMatchIsIllustrative(term: string, position: number): boolean {
  const prefix = term.slice(Math.max(0, position - 48), position);
  return /(?:\b(?:for example|e\.g\.|such as)\s*,?\s*|(?:例如|比如|譬如)\s*[：:,，]?\s*)$/u.test(
    prefix,
  );
}

function routingMatchIsQuoted(term: string, position: number): boolean {
  for (const [open, close] of [
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
  ] as const) {
    const opening = term.lastIndexOf(open, position);
    if (opening !== -1) {
      const closing = term.indexOf(close, opening + open.length);
      if (closing >= position) return true;
    }
  }
  for (const quote of ['"', "'"] as const) {
    const before = term.slice(0, position).split(quote).length - 1;
    if (before % 2 === 1 && term.indexOf(quote, position) !== -1) return true;
  }
  return false;
}

function routingMatchIsNominalReference(
  candidate: string,
  term: string,
  position: number,
): boolean {
  const before =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1)
      ?.trim() ?? '';
  const after = term.slice(position + candidate.length).trimStart();
  if (/\p{Script=Han}/u.test(candidate)) {
    if (
      /^(?:思想|原理|方面|设计|方式|机制|细节|情况|结果|意见|结论|报告|方案|是否|合理)/u.test(after)
    ) {
      return true;
    }
    return /(?:分析|评价|评审|审查|检查|审视|研究|讨论)\s*$/u.test(before);
  }
  return /^(?:result|results|report|reports|feedback|finding|findings)\b/u.test(after);
}

export function matchesRoutingTerm(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  return routingMatchPositions(candidate, term).some(
    (position) => !routingMatchIsNegated(term, position),
  );
}

export function playbookAliasEvidence(trigger: string, term: string): PlaybookAliasEvidence {
  const candidate = normalizeRoutingText(trigger);
  const evidence = { mentioned: false, negated: false, requested: false };
  if (!candidate) return evidence;
  for (const position of routingMatchPositions(candidate, term)) {
    if (routingMatchIsQuoted(term, position) || routingMatchIsIllustrative(term, position))
      continue;
    evidence.mentioned = true;
    if (routingMatchIsNegated(term, position)) {
      evidence.negated = true;
      continue;
    }
    if (
      routingMatchIsRequestedAction(term, position) &&
      !routingMatchIsNominalReference(candidate, term, position)
    ) {
      evidence.requested = true;
    }
  }
  return evidence;
}
