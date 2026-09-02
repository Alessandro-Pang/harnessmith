import { sameCanonicalPath } from './host.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
function parseSingleJsonObject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function tokenizeSingleCommand(command) {
  const source = String(command ?? '').trim();
  if (!source) return null;
  const tokens = [];
  let token = '';
  let quote = null;
  let tokenStarted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (
        character === '`' ||
        character === '\\' ||
        (quote === '"' &&
          character === '$' &&
          /[A-Za-z0-9_({[*@$?!#'"-]/u.test(source[index + 1] ?? ''))
      ) {
        return null;
      }
      token += character;
      tokenStarted = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }
    if (';&|<>`\\$'.includes(character)) return null;
    token += character;
    tokenStarted = true;
  }
  if (quote || !tokenStarted && tokens.length === 0) return null;
  if (tokenStarted) tokens.push(token);
  return tokens.length > 0 && tokens.every(Boolean) ? tokens : null;
}

export function exactCommandTokens(command) {
  let tokens = tokenizeSingleCommand(command);
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      !tokens ||
      tokens.length !== 3 ||
      !['/bin/zsh', '/bin/bash'].includes(tokens[0]) ||
      tokens[1] !== '-lc'
    ) {
      if (tokens?.includes('-lc')) return null;
      return tokens;
    }
    tokens = tokenizeSingleCommand(tokens[2]);
  }
  return null;
}

export function memoryPayloadCommandHasExpectedPrefix({
  commandTokens,
  harnessIndex,
  nodePath,
  harnessPath,
  repo,
}) {
  if (!Array.isArray(commandTokens) || harnessIndex !== 1 || commandTokens.length < 2) {
    return false;
  }
  if (commandTokens[0] !== nodePath && commandTokens[0] !== 'node') return false;
  const invokedHarness = isAbsolute(commandTokens[1])
    ? resolve(commandTokens[1])
    : resolve(repo, commandTokens[1]);
  return sameCanonicalPath(invokedHarness, harnessPath);
}

export function exactCloseHandoffCommandTokens(command, options) {
  const commandTokens = exactCommandTokens(command);
  if (
    !memoryPayloadCommandHasExpectedPrefix({
      ...options,
      commandTokens,
      harnessIndex: 1,
    }) ||
    commandTokens.length !== 10 ||
    commandTokens[2] !== 'memory' ||
    commandTokens[3] !== 'close-handoff' ||
    commandTokens[5] !== '--session' ||
    commandTokens[7] !== '--outcome' ||
    !['completed', 'cancelled'].includes(commandTokens[8]) ||
    commandTokens[9] !== '--json' ||
    commandTokens[4].startsWith('-') ||
    commandTokens[6].startsWith('-') ||
    commandTokens.filter((token) => token === '--session').length !== 1 ||
    commandTokens.filter((token) => token === '--outcome').length !== 1 ||
    commandTokens.filter((token) => token === '--json').length !== 1
  ) {
    return null;
  }
  return commandTokens;
}

export function isUnauditableCloseHandoffCommand(command, options) {
  if (exactCloseHandoffCommandTokens(command, options)) return false;
  const commandTokens = exactCommandTokens(command);
  if (commandTokens) {
    if (
      memoryPayloadCommandHasExpectedPrefix({
        ...options,
        commandTokens,
        harnessIndex: 1,
      }) &&
      commandTokens.length === 5 &&
      commandTokens[2] === 'memory' &&
      commandTokens[3] === 'close-handoff' &&
      ['--help', '-h'].includes(commandTokens[4])
    ) {
      return false;
    }
    const invokedHarness = commandTokens[1]
      ? (isAbsolute(commandTokens[1])
          ? resolve(commandTokens[1])
          : resolve(options.repo, commandTokens[1]))
      : null;
    return Boolean(
      basename(commandTokens[0] ?? '') === 'node' &&
        invokedHarness === resolve(options.harnessPath) &&
        commandTokens[2] === 'memory' &&
        commandTokens[3] === 'close-handoff',
    );
  }
  const source = String(command ?? '').trim();
  const beginsAsExecutableInvocation =
    source.startsWith('node ') ||
    source.startsWith(`${options.nodePath} `) ||
    source.startsWith('/bin/zsh -lc ') ||
    source.startsWith('/bin/bash -lc ');
  return Boolean(
    beginsAsExecutableInvocation &&
      source.includes(options.harnessPath) &&
      /\bmemory\s+close-handoff\b/i.test(source),
  );
}

export function markEarlierReusedPayloadSnapshotsAmbiguous(evidence) {
  const entries = Array.isArray(evidence) ? evidence : [];
  const lastIndexByPath = new Map();
  for (const [index, entry] of entries.entries()) {
    if (entry?.resolvedPayloadPath) lastIndexByPath.set(entry.resolvedPayloadPath, index);
  }
  return entries.map((entry, index) => {
    if (
      !entry?.resolvedPayloadPath ||
      lastIndexByPath.get(entry.resolvedPayloadPath) === index
    ) {
      return entry;
    }
    return {
      ...entry,
      payload: {
        ok: false,
        value: null,
        temporalAmbiguous: true,
        error: 'payload path was reused later in the same turn; execution-time content is unavailable',
      },
    };
  });
}

const remoteCommandPattern =
  /(?:^|[;&|()'\"]\s*|\s)(?:[^\s;&|()'\"]+\/)?(?:curl|wget|ssh|scp|sftp|nc|ncat)\b|\bgit\s+(?:push|pull|fetch)\b|\b(?:npm|pnpm|yarn)\s+publish\b|\bgh\s+api\b/i;
const destructiveCommandPattern =
  /(?:^|[;&|()'\"]\s*|\s)(?:[^\s;&|()'\"]+\/)?(?:rm|rmdir|unlink|shred|truncate)\b|\bgit\s+(?:reset\s+--hard|clean\b)|\bfind\b[^\n]*(?:-delete|-exec\s+rm)\b/i;

function gitSubcommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(value)) {
      index += 1;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace)=/.test(value) || value.startsWith('-')) continue;
    return value;
  }
  return null;
}

export function classifyBoundaryCommand(command) {
  const tokens = exactCommandTokens(command);
  if (tokens) {
    const executable = basename(tokens[0]);
    const args = tokens.slice(1);
    const gitAction = executable === 'git' ? gitSubcommand(args) : null;
    return {
      remote:
        ['curl', 'wget', 'ssh', 'scp', 'sftp', 'nc', 'ncat'].includes(executable) ||
        (executable === 'git' && ['push', 'pull', 'fetch'].includes(gitAction)) ||
        (['npm', 'pnpm', 'yarn'].includes(executable) && args.includes('publish')) ||
        (executable === 'gh' && args[0] === 'api'),
      destructive:
        ['rm', 'rmdir', 'unlink', 'shred', 'truncate'].includes(executable) ||
        (executable === 'git' &&
          ((gitAction === 'reset' && args.includes('--hard')) || gitAction === 'clean')) ||
        (executable === 'find' &&
          (args.includes('-delete') ||
            args.some((value, index) => value === '-exec' && basename(args[index + 1] ?? '') === 'rm'))),
    };
  }
  const source = String(command ?? '');
  return {
    remote: remoteCommandPattern.test(source),
    destructive: destructiveCommandPattern.test(source),
  };
}

