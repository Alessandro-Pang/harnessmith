export interface PlaybookAliasEvidence {
  mentioned: boolean;
  negated: boolean;
  requested: boolean;
  /** A request carried by a compound domain alias rather than a generic verb. */
  specific: boolean;
}

/** Explaining is a byproduct of any other action, so it never adds a second coordinated request. */
const explanatoryAliases = new Set(['explain', '讲解', '说明']);

export function normalizeRoutingText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('und')
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
  return /(?:\b(?:do\s+not|don't|not|never|without|no)\s+(?:\p{L}+\s+){0,2}|(?:不要|无需|不必|别|禁止|避免|不)(?:[\p{Script=Han}\p{L}\p{N}]+\s*){0,2})$/u.test(
    clause,
  );
}

function routingMatchIsRequestedAction(candidate: string, term: string, position: number): boolean {
  const clause =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1) ?? '';
  const prefix = clause.trim();
  if (prefix === '') return true;
  if (
    /^(?:please|can you|could you|would you|i want you to|i need you to|i(?:'d)?\s+(?:want|need|would like)\s+to|we\s+(?:need|want)\s+to|please\s+help\s+me|(?:can|could|would) you please|let(?:'s| us)|now|then|also)$/u.test(
      prefix,
    )
  ) {
    return true;
  }
  // A second action after a coordinator is still requested: "review and fix" asks for both, and
  // collapsing it to the first verb silently drops half of the request.
  if (!explanatoryAliases.has(candidate)) {
    if (/(?:^|[^\p{L}\p{N}])(?:and(?:\s+then)?|then|plus|also)$/u.test(prefix)) return true;
    if (/(?:并且?|然后|接着|再|顺便)$/u.test(prefix)) return true;
  }
  return /^(?:(?:(?:请你?|请帮忙|请协助|帮我|给我|我想(?:要)?|我需要|我希望|希望你?|现在|继续|重新|开始|进行|执行|来|需要|要求|想要|逐个|并|只)\s*)+|(?:结合|基于|根据)[\p{L}\p{N} ._-]{0,40}(?:来)?)$/u.test(
    prefix,
  );
}

/**
 * Compound aliases name a domain rather than reuse a common verb, so they can
 * outrank a generic verb in the same clause. High-loss aliases such as
 * remote-write stay mention-only unless they sit in a request position.
 */
function routingAliasIsSpecific(candidate: string): boolean {
  if (candidate.includes(' ')) return true;
  return /\p{Script=Han}/u.test(candidate) && [...candidate].length >= 3;
}

function routingAliasIsSymptomCompound(candidate: string): boolean {
  return /失败|故障|缺陷|事故|报错|异常|failure|failing|incident/u.test(candidate);
}

// Everything between the example marker and the alias stays illustrative until a sentence ends, so
// the second item of "for example, review and implement" is not read as a request either.
function routingMatchIsIllustrative(term: string, position: number): boolean {
  const prefix = term.slice(Math.max(0, position - 48), position);
  return /(?:\b(?:for example|e\.g|such as)[\p{L}\p{N}\s,;:'"]{0,40}|(?:例如|比如|譬如|举例(?:说明)?)[\p{Script=Han}\p{L}\p{N}\s、，：:；]{0,40})$/u.test(
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
    // "发布后" names a point in time, not a request to release.
    if (
      /^(?:思想|原理|方面|设计|方式|机制|细节|情况|结果|意见|结论|报告|方案|是否|合理|后|前|时|中|之后|之前|期间)/u.test(
        after,
      )
    ) {
      return true;
    }
    // Only verbs that are themselves action aliases may demote what follows them to an object;
    // otherwise removing an alias would leave a verb that suppresses routing without providing any.
    return /(?:分析|评价|评审|审查|审视|研究|讨论)\s*$/u.test(before);
  }
  return /^(?:result|results|report|reports|feedback|finding|findings)\b/u.test(after);
}

/**
 * "Prompt 的优化" nominalizes the verb into the subject under discussion. This demotes action
 * aliases only; concept aliases are routinely introduced by the same possessive marker
 * ("仓库的模块关系"), where they name exactly what the request is about.
 */
function routingActionIsPossessiveNoun(term: string, position: number): boolean {
  return /的\s*$/u.test(term.slice(Math.max(0, position - 8), position));
}

export function matchesRoutingTerm(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  return routingMatchPositions(candidate, term).some(
    (position) => !routingMatchIsNegated(term, position),
  );
}

/**
 * Match a reasoning alias only when it is an actionable concept. Quoted,
 * illustrative, nominal, and negated mentions are retained as context but do
 * not activate a mode.
 */
export function matchesReasoningTerm(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  return routingMatchPositions(candidate, term).some(
    (position) =>
      !routingMatchIsNegated(term, position) &&
      !routingMatchIsQuoted(term, position) &&
      !routingMatchIsIllustrative(term, position) &&
      !routingMatchIsNominalReference(candidate, term, position),
  );
}

export function playbookAliasEvidence(trigger: string, term: string): PlaybookAliasEvidence {
  const candidate = normalizeRoutingText(trigger);
  const evidence = { mentioned: false, negated: false, requested: false, specific: false };
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
      routingMatchIsNominalReference(candidate, term, position) ||
      routingActionIsPossessiveNoun(term, position)
    )
      continue;
    const specific = routingAliasIsSpecific(candidate);
    if (
      routingMatchIsRequestedAction(candidate, term, position) ||
      (specific && routingAliasIsSymptomCompound(candidate))
    ) {
      evidence.requested = true;
      evidence.specific = evidence.specific || specific;
    }
  }
  return evidence;
}
