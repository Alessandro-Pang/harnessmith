import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { exactCommandTokens, parseSingleJsonObject } from './commands.mjs';
import { jsonlEvents } from './transcript.mjs';

export {
  containsApiWorkerBoundary,
  containsRetryInvestigationContext,
  isCodeReviewProfileKey,
  isExplicitProfileControlRoutingViolation,
  isUnauditableMemoryPayloadCommand,
  mentionsRetryInvestigationContext,
  remoteToolViolatesWriteBoundary,
} from './boundary-content.mjs';

/** @param {string} path @param {string} root */
function pathWithin(path, root) {
  const candidate = resolve(path);
  const boundary = resolve(root);
  const relation = relative(boundary, candidate);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

/** @param {string} path @param {string} root */
export function canonicalPathWithin(path, root) {
  try {
    return pathWithin(realpathSync.native(resolve(path)), realpathSync.native(resolve(root)));
  } catch {
    return pathWithin(path, root);
  }
}

/** @param {string} path @param {string} root */
export function inspectJsonPayloadPath(path, root) {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (!resolvedPath.endsWith('.json')) {
    return { ok: false, resolvedPath, error: 'payload path must end in .json' };
  }
  if (!canonicalPathWithin(resolvedPath, resolvedRoot)) {
    return { ok: false, resolvedPath, error: 'payload path is outside the task temp root' };
  }
  try {
    const rootEntry = lstatSync(resolvedRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      return { ok: false, resolvedPath, error: 'task temp root is not a regular directory' };
    }
    const realRoot = realpathSync.native(resolvedRoot);
    const realPath = realpathSync.native(resolvedPath);
    if (!pathWithin(resolvedPath, resolvedRoot) && resolvedPath !== realPath) {
      return { ok: false, resolvedPath, error: 'payload path contains a symlink component' };
    }
    const relativePath = relative(realRoot, realPath);
    let current = realRoot;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      if (lstatSync(current).isSymbolicLink()) {
        return { ok: false, resolvedPath, error: 'payload path contains a symlink component' };
      }
    }
    const entry = lstatSync(resolvedPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      return { ok: false, resolvedPath, error: 'payload is not a regular non-symlink file' };
    }
    if (!pathWithin(realPath, realRoot)) {
      return { ok: false, resolvedPath, error: 'payload real path escapes the task temp root' };
    }
    return { ok: true, resolvedPath, realPath };
  } catch (error) {
    return { ok: false, resolvedPath, error: String(error) };
  }
}

/** @param {string} path @param {string} root */
export function inspectProjectScopePath(path, root) {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (!pathWithin(resolvedPath, resolvedRoot)) {
    return { ok: false, exists: false, resolvedPath, error: 'scope path escapes the project root' };
  }
  try {
    const rootEntry = lstatSync(resolvedRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      return {
        ok: false,
        exists: false,
        resolvedPath,
        error: 'project root is not a regular directory',
      };
    }
    const relativePath = relative(resolvedRoot, resolvedPath);
    let current = resolvedRoot;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      let entry;
      try {
        entry = lstatSync(current);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return { ok: true, exists: false, resolvedPath };
        }
        throw error;
      }
      if (entry.isSymbolicLink()) {
        return {
          ok: false,
          exists: true,
          resolvedPath,
          error: 'scope path contains a symlink component',
        };
      }
    }
    const realRoot = realpathSync(resolvedRoot);
    const realPath = realpathSync(resolvedPath);
    if (!pathWithin(realPath, realRoot)) {
      return {
        ok: false,
        exists: true,
        resolvedPath,
        error: 'scope real path escapes the project root',
      };
    }
    return { ok: true, exists: true, resolvedPath, realPath };
  } catch (error) {
    return { ok: false, exists: false, resolvedPath, error: String(error) };
  }
}

/** @param {{ exact?: boolean, completed?: boolean, payloadPathOk?: boolean, scopePathOk?: boolean }} attempt */
export function memoryPayloadAttemptViolatesBoundary({
  exact,
  completed,
  payloadPathOk,
  scopePathOk,
}) {
  return payloadPathOk !== true || scopePathOk !== true || (completed === true && exact !== true);
}

/** @param {string} path @param {string[]} allowedPaths */
function pathAllowed(path, allowedPaths) {
  return allowedPaths.some((allowed) => {
    if (!allowed.endsWith('/**')) return path === allowed;
    const root = allowed.slice(0, -3);
    return path === root || path.startsWith(`${root}/`);
  });
}

/** @param {{ projectPaths?: string[], allowedProjectPaths?: string[], globalMemoryPaths?: string[], allowedGlobalMemoryPaths?: string[], personalPaths?: string[], targetPaths?: string[], outsidePaths?: string[], evaluatorPaths?: string[], boundaryViolations?: string[], treeErrors?: string[], beforeHead?: string | null, afterHead?: string | null }} input */
export function memoryAutopilotBoundaryIsSafe({
  projectPaths = [],
  allowedProjectPaths = [],
  globalMemoryPaths = [],
  allowedGlobalMemoryPaths = [],
  personalPaths = [],
  targetPaths = [],
  outsidePaths = [],
  evaluatorPaths = [],
  boundaryViolations = [],
  treeErrors = [],
  beforeHead,
  afterHead,
}) {
  return Boolean(
    projectPaths.every((path) => pathAllowed(path, allowedProjectPaths)) &&
      globalMemoryPaths.every((path) => pathAllowed(path, allowedGlobalMemoryPaths)) &&
      personalPaths.length === 0 &&
      targetPaths.length === 0 &&
      outsidePaths.length === 0 &&
      evaluatorPaths.length === 0 &&
      boundaryViolations.length === 0 &&
      treeErrors.length === 0 &&
      beforeHead &&
      beforeHead === afterHead,
  );
}

/** @param {unknown} stdout */
export function extractHandoffInvocations(stdout) {
  return jsonlEvents(stdout).flatMap((event) => {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'command_execution') return [];
    const command = String(item.command ?? '');
    const tokens = exactCommandTokens(command);
    if (!tokens) return [];
    if (
      tokens.length !== 8 ||
      basename(tokens[0]) !== 'node' ||
      !/(?:^|\/)harness\.mjs$/i.test(tokens[1]) ||
      tokens[2] !== 'memory' ||
      tokens[3] !== 'handoff' ||
      tokens[5] !== '--payload-file' ||
      tokens[7] !== '--json' ||
      tokens.filter((token) => token === '--payload-file').length !== 1 ||
      tokens.filter((token) => token === '--json').length !== 1 ||
      tokens[6].startsWith('-')
    ) {
      return [];
    }
    const payloadPath = tokens[6];
    if (!payloadPath || payloadPath.startsWith('$')) return [];
    const output = String(item.aggregated_output ?? '');
    const parsed = parseSingleJsonObject(output);
    return [
      {
        command,
        payloadPath,
        exitCode: item.exit_code,
        completed: item.status === 'completed' && item.exit_code === 0,
        action: typeof parsed?.action === 'string' ? parsed.action : null,
        parsedOutput: parsed,
        output,
      },
    ];
  });
}
