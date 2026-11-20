import { createHash } from 'node:crypto';
import { parseSingleJsonObject } from './commands.mjs';

/**
 * @param {string} output
 * @returns {import('./types.mjs').InstallCaptureEnvelope | null}
 */
export function parseInstallCaptureEnvelope(output) {
  const value = parseSingleJsonObject(output);
  if (
    value?.version !== 1 ||
    typeof value.status !== 'number' ||
    !Number.isInteger(value.status) ||
    (value.signal !== null && typeof value.signal !== 'string') ||
    typeof value.stdout !== 'string' ||
    typeof value.stderr !== 'string' ||
    (value.error !== null && typeof value.error !== 'string') ||
    typeof value.commandSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.commandSha256)
  ) {
    return null;
  }
  return {
    version: 1,
    status: value.status,
    signal: value.signal,
    stdout: value.stdout,
    stderr: value.stderr,
    error: value.error,
    commandSha256: value.commandSha256,
  };
}

/** @param {string} value */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} input */
function sanitizedText(input) {
  return String(input)
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /-----BEGIN (?:(?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g,
      '[REDACTED PRIVATE KEY HEADER]',
    )
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(
      /("(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret|cookie)"\s*:\s*")[^"]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(/\b(password|token|secret|cookie|api[_-]?key)=([^\s&]+)/gi, '$1=[REDACTED]')
    .replace(
      /\b(?:AKIA[0-9A-Z]{16}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|sk_live_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{8,})\b/g,
      '[REDACTED TOKEN]',
    );
}

/**
 * @param {string} value
 * @param {number} budget
 */
function prefixWithinBytes(value, budget) {
  if (budget <= 0) return '';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

/**
 * @param {string} value
 * @param {number} budget
 */
function suffixWithinBytes(value, budget) {
  if (budget <= 0) return '';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(value.length - middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return value.slice(value.length - low);
}

/**
 * @param {unknown} input
 * @param {number} [maxBytes]
 */
export function sanitizeAndBoundArtifact(input, maxBytes = 7 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) {
    throw new Error(`Invalid artifact byte budget: ${String(maxBytes)}`);
  }
  const sanitized = sanitizedText(input);
  const sanitizedBytes = Buffer.byteLength(sanitized);
  const fullSanitizedSha256 = sha256(sanitized);
  if (sanitizedBytes <= maxBytes) {
    return {
      content: sanitized,
      truncated: false,
      sanitizedBytes,
      fullSanitizedSha256,
      omittedBytes: 0,
    };
  }
  const marker = `\n[TRUNCATED full_sanitized_sha256=${fullSanitizedSha256} sanitized_bytes=${sanitizedBytes}]\n`;
  const available = Math.max(0, maxBytes - Buffer.byteLength(marker));
  const headBudget = Math.floor(available * 0.6);
  const tailBudget = available - headBudget;
  const head = prefixWithinBytes(sanitized, headBudget);
  const tail = suffixWithinBytes(sanitized, tailBudget);
  const content = `${head}${marker}${tail}`;
  return {
    content,
    truncated: true,
    sanitizedBytes,
    fullSanitizedSha256,
    omittedBytes: sanitizedBytes - Buffer.byteLength(head) - Buffer.byteLength(tail),
  };
}

/**
 * @param {import('./types.mjs').ToolActionDescriptor[]} descriptors
 * @param {{ maxItems?: number, targetBytes?: number }} [options]
 */
export function toolActionArtifactBounds(
  descriptors,
  { maxItems = 1024, targetBytes = 1024 } = {},
) {
  if (!Array.isArray(descriptors)) throw new Error('Tool action descriptors must be an array');
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
    throw new Error(`Invalid tool action item budget: ${String(maxItems)}`);
  }
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 256) {
    throw new Error(`Invalid tool action target byte budget: ${String(targetBytes)}`);
  }
  const countExceeded = descriptors.length > maxItems;
  const targetTruncated = descriptors.some(
    ({ target }) =>
      sanitizeAndBoundArtifact(target || '(target unavailable)', targetBytes).truncated,
  );
  return {
    originalCount: descriptors.length,
    recordedCount: Math.min(descriptors.length, maxItems),
    originalSha256: sha256(JSON.stringify(descriptors)),
    targetTruncated,
    countExceeded,
    exceeded: countExceeded,
  };
}
