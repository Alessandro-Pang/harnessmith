/**
 * @param {unknown} value
 * @returns {import('./types.mjs').MemoryPayloadOutput | null}
 */
export function parseSingleJsonObject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {unknown} command */
export function tokenizeSingleCommand(command) {
  const source = String(command ?? '').trim();
  if (!source) return null;
  /** @type {string[]} */
  const tokens = [];
  let token = '';
  /** @type {string | null} */
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
  if (quote || (!tokenStarted && tokens.length === 0)) return null;
  if (tokenStarted) tokens.push(token);
  return tokens.length > 0 && tokens.every(Boolean) ? tokens : null;
}

/** @param {unknown} command */
export function exactCommandTokens(command) {
  let tokens = tokenizeSingleCommand(command);
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      tokens?.length !== 3 ||
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
