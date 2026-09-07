import { sameCanonicalPath } from './host.mjs';
import { exactCommandTokens } from './commands.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
const readCommandNames = new Set(['cat', 'sed', 'head', 'tail', 'rg', 'grep', 'awk', 'perl', 'node']);

export function commandInvokesReadTool(command) {
  const tokens = exactCommandTokens(command);
  return Boolean(tokens?.length && readCommandNames.has(basename(tokens[0])));
}

export function commandReadsProjectMemoryStandardAlone(command) {
  const source = String(command ?? '').trim();
  if (!source || /[\r\n]/u.test(source)) return false;
  const tokens = exactCommandTokens(source);
  if (!tokens?.length) return false;
  const reader = basename(tokens[0]);
  const args = tokens.slice(1);
  const standardPath = /agent-harness\/docs\/standards\/project-agent-docs\.md$/iu;
  const readsStandard = (value) => standardPath.test(value ?? '');
  if (args.filter(readsStandard).length !== 1 || !readsStandard(args.at(-1))) return false;
  if (reader === 'cat') return args.length === 1;
  if (reader === 'sed') {
    return (
      args.length === 3 &&
      args[0] === '-n' &&
      (/^\d+(?:,\d+)?p$/u.test(args[1]) ||
        args[1] === '/^## 自动 sidecar 静默输出$/,/^## /p')
    );
  }
  if (reader === 'rg') {
    const pattern = args.at(-2) ?? '';
    const options = args.slice(0, -2);
    if (!pattern || pattern.startsWith('-')) return false;
    let boundedContext = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings'].includes(option)) {
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

function splitSafeConjunction(source) {
  const segments = [];
  let start = 0;
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
    if (character === '&' && source[index + 1] === '&') {
      const segment = source.slice(start, index).trim();
      if (!segment) return null;
      segments.push(segment);
      start = index + 2;
      index += 1;
      continue;
    }
    if (';|<>`\\$'.includes(character) || character === '&') return null;
  }
  if (quote) return null;
  const finalSegment = source.slice(start).trim();
  if (!finalSegment) return null;
  segments.push(finalSegment);
  return segments;
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

function splitSafeReadChain(source) {
  const segments = [];
  let start = 0;
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

export function commandReadSegments(command) {
  const source = String(command ?? '').trim();
  const exact = exactCommandTokens(source);
  if (exact) {
    return auditableReadCommandNames.has(basename(exact[0])) ? [exact] : [];
  }
  const outerTokens = tokenizeSingleCommand(source);
  if (
    !outerTokens ||
    outerTokens.length !== 3 ||
    !['/bin/zsh', '/bin/bash'].includes(outerTokens[0]) ||
    outerTokens[1] !== '-lc'
  ) {
    return [];
  }
  const segments = splitSafeReadChain(outerTokens[2]);
  if (!segments) return [];
  const parsed = segments.map((segment) => tokenizeSingleCommand(segment));
  if (
    parsed.some(
      (tokens) => !tokens?.length || !auditableReadCommandNames.has(basename(tokens[0])),
    )
  ) {
    return [];
  }
  return parsed;
}

function classifyExactMemoryHelp(
  tokens,
  { nodePath, harnessPath, allowLiteralNode = false },
) {
  const harnessIndex = tokens.findIndex((token) => /(?:^|\/)harness\.mjs$/i.test(token));
  if (
    harnessIndex !== 1 ||
    !(
      tokens[0] === nodePath ||
      (allowLiteralNode && tokens[0] === 'node')
    ) ||
    tokens[1] !== harnessPath ||
    tokens[harnessIndex + 1] !== 'memory'
  ) {
    return { memory: false, readOnlyHelp: false };
  }
  return {
    memory: true,
    readOnlyHelp:
      tokens.length === harnessIndex + 4 &&
      ['--help', '-h'].includes(tokens[harnessIndex + 3]),
  };
}

function exactCommandIsReadOnlyProfileInspection(tokens, profilePath) {
  const executable = tokens[0];
  if (executable === 'cat') {
    return tokens.length === 2 && tokens[1] === profilePath;
  }
  if (['head', 'tail'].includes(executable)) {
    return (
      tokens.length === 4 &&
      tokens[1] === '-n' &&
      /^\d+$/.test(tokens[2]) &&
      tokens[3] === profilePath
    );
  }
  return (
    executable === 'sed' &&
    tokens.length === 4 &&
    tokens[1] === '-n' &&
    /^\d+(?:,\d+)?p$/.test(tokens[2]) &&
    tokens[3] === profilePath
  );
}

export function commandHasReadOnlyHelp(
  command,
  { nodePath, harnessPath, profilePath, allowLiteralNode = false } = {},
) {
  const isInertAbsolutePath = (path) =>
    typeof path === 'string' && isAbsolute(path) && /^[A-Za-z0-9_./-]+$/.test(path);
  if (
    !isInertAbsolutePath(nodePath) ||
    !isInertAbsolutePath(harnessPath) ||
    !isInertAbsolutePath(profilePath)
  ) {
    return false;
  }
  const expectedPaths = { nodePath, harnessPath, allowLiteralNode };
  const source = String(command ?? '').trim();
  const exactTokens = exactCommandTokens(source);
  if (exactTokens) {
    return classifyExactMemoryHelp(exactTokens, expectedPaths).readOnlyHelp;
  }

  const outerTokens = tokenizeSingleCommand(source);
  if (
    !outerTokens ||
    outerTokens.length !== 3 ||
    !['/bin/zsh', '/bin/bash'].includes(outerTokens[0]) ||
    outerTokens[1] !== '-lc'
  ) {
    return false;
  }
  const segments = splitSafeConjunction(outerTokens[2]);
  if (!segments) return false;
  let sawMemoryHelp = false;
  for (const segment of segments) {
    const tokens = tokenizeSingleCommand(segment);
    if (!tokens) return false;
    const classification = classifyExactMemoryHelp(tokens, expectedPaths);
    if (classification.memory) {
      if (!classification.readOnlyHelp) return false;
      sawMemoryHelp = true;
    } else if (!exactCommandIsReadOnlyProfileInspection(tokens, profilePath)) {
      return false;
    }
  }
  return sawMemoryHelp;
}

export function parseMemoryPayloadCommand(command) {
  const tokens = exactCommandTokens(command);
  if (!tokens) return null;
  if (
    tokens.some(
      (token, index) =>
        ['--help', '-h'].includes(token) && tokens[index - 1] !== '--payload-file',
    )
  ) {
    return null;
  }
  const harnessIndex = tokens.findIndex((token) => /(?:^|\/)harness\.mjs$/i.test(token));
  const action =
    harnessIndex >= 0 && tokens[harnessIndex + 1] === 'memory'
      ? tokens[harnessIndex + 2]
      : null;
  if (!['capture-input', 'handoff', 'reconcile-profile'].includes(action)) return null;
  const payloadIndexes = tokens.flatMap((token, index) =>
    token === '--payload-file' ? [index] : [],
  );
  return {
    action,
    harnessIndex,
    payloadIndexes,
    payloadPath:
      payloadIndexes.length === 1 ? tokens[payloadIndexes[0] + 1] ?? null : null,
    scopePath: action === 'reconcile-profile' ? null : tokens[harnessIndex + 3] ?? null,
    tokens,
  };
}

export function selectSingleSuccessfulMemoryPayloadInvocation(
  invocations,
  { turn, action, outputActions = [], allowUnobserved = false },
) {
  const allowedOutputActions = new Set(outputActions);
  const completedExactAttempts = invocations.filter(
    (item) =>
      item?.turn === turn &&
      item?.action === action &&
      item?.exact === true &&
      item?.completed === true &&
      (allowedOutputActions.size === 0 ||
        allowedOutputActions.has(item?.output?.action) ||
        (allowUnobserved &&
          item?.outputObserved === false &&
          (item?.output === null || item?.output === undefined))),
  );
  if (completedExactAttempts.length !== 1) return null;
  return completedExactAttempts[0]?.payload?.ok === true
    ? completedExactAttempts[0]
    : null;
}

export function singleExactPayloadMutationAttempt(
  invocations,
  selected,
  { turn, action },
) {
  const attempts = invocations.filter(
    (item) => item?.turn === turn && item?.action === action,
  );
  return Boolean(
    attempts.length === 1 &&
      attempts[0] === selected &&
      selected?.exact === true &&
      selected?.completed === true &&
      selected?.payload?.ok === true,
  );
}

