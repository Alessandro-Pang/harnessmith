import { basename } from 'node:path';
import { exactCommandTokens, tokenizeSingleCommand } from './commands.mjs';

const readCommandNames = new Set([
  'cat',
  'sed',
  'head',
  'tail',
  'rg',
  'grep',
  'awk',
  'perl',
  'node',
]);

/** @param {unknown} command */
export function commandInvokesReadTool(command) {
  const tokens = exactCommandTokens(command);
  return Boolean(tokens?.length && readCommandNames.has(basename(tokens[0])));
}

/** @param {unknown} command */
export function commandReadsProjectMemoryStandardAlone(command) {
  const source = String(command ?? '').trim();
  if (!source || /[\r\n]/u.test(source)) return false;
  const tokens = exactCommandTokens(source);
  if (!tokens?.length) return false;
  const reader = basename(tokens[0]);
  const args = tokens.slice(1);
  const standardPath = /agent-harness\/docs\/standards\/project-agent-docs\.md$/iu;
  /** @param {string | undefined} value */
  const readsStandard = (value) => standardPath.test(value ?? '');
  if (args.filter(readsStandard).length !== 1 || !readsStandard(args.at(-1))) return false;
  if (reader === 'cat') return args.length === 1;
  if (reader === 'sed') {
    return (
      args.length === 3 &&
      args[0] === '-n' &&
      (/^\d+(?:,\d+)?p$/u.test(args[1]) || args[1] === '/^## 自动 sidecar 静默输出$/,/^## /p')
    );
  }
  if (reader === 'rg') {
    const pattern = args.at(-2) ?? '';
    const options = args.slice(0, -2);
    if (!pattern || pattern.startsWith('-')) return false;
    let boundedContext = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (
        ['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings'].includes(option)
      ) {
        continue;
      }
      if (['-C', '--context'].includes(option)) {
        const count = Number(options[index + 1]);
        if (!Number.isInteger(count) || count < 1 || count > 20) return false;
        boundedContext = true;
        index += 1;
        continue;
      }
      const compactContext = option.match(/^(?:-C|--context=)(\d+)$/u);
      if (!compactContext) return false;
      const count = Number(compactContext[1]);
      if (count < 1 || count > 20) return false;
      boundedContext = true;
    }
    return boundedContext;
  }
  if (!['head', 'tail'].includes(reader)) return false;
  return (
    args.length === 1 ||
    (args.length === 2 && /^-\d+$/u.test(args[0])) ||
    (args.length === 3 && args[0] === '-n' && /^\d+$/u.test(args[1]))
  );
}

/** @param {{ quietPosition: number, firstAgentMessagePosition: number, metadataPosition: number, corePosition: number, taskPosition: number, maintainPosition: number, matchedPositions: number[], authoritativePosition: number }} positions */
export function projectMemoryReadOrderIsValid({
  quietPosition,
  firstAgentMessagePosition,
  metadataPosition,
  corePosition,
  taskPosition,
  maintainPosition,
  matchedPositions,
  authoritativePosition,
}) {
  const fixedPositions = [
    quietPosition,
    firstAgentMessagePosition,
    metadataPosition,
    corePosition,
    taskPosition,
    maintainPosition,
    authoritativePosition,
  ];
  if (
    fixedPositions.some((position) => !Number.isInteger(position) || position < 0) ||
    !Array.isArray(matchedPositions) ||
    matchedPositions.length === 0 ||
    matchedPositions.some((position) => !Number.isInteger(position) || position < 0)
  ) {
    return false;
  }
  return (
    quietPosition < firstAgentMessagePosition &&
    quietPosition < metadataPosition &&
    metadataPosition < corePosition &&
    corePosition < taskPosition &&
    taskPosition < maintainPosition &&
    matchedPositions.every(
      (position) => position > maintainPosition && position < authoritativePosition,
    )
  );
}

/** @param {unknown} content */
export function containsAssertedObsoleteRecall(content) {
  return String(content ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some(
      (line) =>
        /^(?:The boundary is\s+)?API\s*->\s*LegacyWorker\.$/iu.test(line) ||
        /^Old investigation state\.$/iu.test(line),
    );
}

const auditableReadCommandNames = new Set([
  'cat',
  'sed',
  'head',
  'tail',
  'rg',
  'grep',
  'awk',
  'sort',
]);

/** @param {string} source */
function splitSafeReadChain(source) {
  /** @type {string[]} */
  const segments = [];
  let start = 0;
  /** @type {string | null} */
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      if (character === '`' || character === '\\' || (quote === '"' && character === '$')) {
        return null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    const conjunction = character === '&' && source[index + 1] === '&';
    const pipeline = character === '|' && source[index + 1] !== '|';
    if (conjunction || pipeline) {
      const segment = source.slice(start, index).trim();
      if (!segment) return null;
      segments.push(segment);
      index += conjunction ? 1 : 0;
      start = index + 1;
      continue;
    }
    if (';&|<>`\\$'.includes(character)) return null;
  }
  if (quote) return null;
  const finalSegment = source.slice(start).trim();
  if (!finalSegment) return null;
  segments.push(finalSegment);
  return segments;
}

/** @param {unknown} command */
export function commandReadSegments(command) {
  const source = String(command ?? '').trim();
  const exact = exactCommandTokens(source);
  if (exact) {
    return auditableReadCommandNames.has(basename(exact[0])) ? [exact] : [];
  }
  const outerTokens = tokenizeSingleCommand(source);
  if (
    outerTokens?.length !== 3 ||
    !['/bin/zsh', '/bin/bash'].includes(outerTokens[0]) ||
    outerTokens[1] !== '-lc'
  ) {
    return [];
  }
  const segments = splitSafeReadChain(outerTokens[2]);
  if (!segments) return [];
  /** @type {string[][]} */
  const parsed = [];
  for (const segment of segments) {
    const tokens = tokenizeSingleCommand(segment);
    if (!tokens?.length || !auditableReadCommandNames.has(basename(tokens[0]))) return [];
    parsed.push(tokens);
  }
  return parsed;
}
