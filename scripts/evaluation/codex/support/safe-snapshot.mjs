import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const DEFAULT_LIMITS = {
  maxDepth: 24,
  maxFiles: 10_000,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

/**
 * @param {string} path
 * @param {string} canonicalRoot
 */
function containedRealPath(path, canonicalRoot) {
  const canonical = realpathSync.native(path);
  const rel = relative(canonicalRoot, canonical);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Snapshot realpath escapes its root');
  }
  return canonical;
}

/**
 * Read a deterministic regular-file tree without following any symbolic link.
 * Entries record the Git-visible executable bit (any of 0o111, matching Git's
 * 100644/100755 decision) so mode-only changes are detectable without picking up
 * unstable non-executable permission bits.
 *
 * @param {string} root
 * @param {{ includeContent?: boolean, ignore?: (path: string) => boolean, prefix?: string, maxDepth?: number, maxFiles?: number, maxFileBytes?: number, maxTotalBytes?: number }} [options]
 */
export function snapshotRegularFileTree(root, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const includeContent = options.includeContent === true;
  const ignore = typeof options.ignore === 'function' ? options.ignore : () => false;
  const prefix = options.prefix
    ? String(options.prefix).replaceAll('\\', '/').replace(/\/$/u, '')
    : '';
  /** @type {import('./types.mjs').FileSnapshot} */
  const snapshot = {};
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return snapshot;
    }
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Snapshot root must be a real directory, not a symlink or special file');
  }
  const canonicalRoot = realpathSync.native(root);
  let fileCount = 0;
  let totalBytes = 0;

  /**
   * @param {string} directory
   * @param {string} relativeDirectory
   * @param {number} depth
   */
  const visit = (directory, relativeDirectory, depth) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      const path = join(directory, name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (ignore(relativePath)) continue;
      const childDepth = depth + 1;
      if (childDepth > limits.maxDepth) {
        throw new Error(`Snapshot depth budget exceeded at ${relativePath}`);
      }
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error(`Snapshot symlink is forbidden at ${relativePath}`);
      if (stat.isDirectory()) {
        containedRealPath(path, canonicalRoot);
        visit(path, relativePath, childDepth);
        continue;
      }
      if (!stat.isFile())
        throw new Error(`Snapshot entry is not a regular file at ${relativePath}`);
      fileCount += 1;
      if (fileCount > limits.maxFiles) throw new Error('Snapshot file count budget exceeded');
      if (stat.size > limits.maxFileBytes) {
        throw new Error(`Snapshot file byte budget exceeded at ${relativePath}`);
      }
      containedRealPath(path, canonicalRoot);
      const content = readFileSync(path);
      totalBytes += content.length;
      if (totalBytes > limits.maxTotalBytes) throw new Error('Snapshot total byte budget exceeded');
      const key = prefix ? `${prefix}/${relativePath}` : relativePath;
      snapshot[key] = {
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        executable: (stat.mode & 0o111) !== 0,
        ...(includeContent ? { content: content.toString('utf8') } : {}),
      };
    }
  };

  visit(root, '', 0);
  return snapshot;
}

/**
 * @param {{ before: import('./types.mjs').FileSnapshot, after: import('./types.mjs').FileSnapshot, allowedPrefixes?: string[] }} input
 */
export function evaluateRepositoryForbiddenContract({ before, after, allowedPrefixes = [] }) {
  const changedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => !allowedPrefixes.some((prefix) => path.startsWith(prefix)))
    .filter(
      (path) =>
        before[path]?.sha256 !== after[path]?.sha256 ||
        // Legacy recorded snapshots may predate mode capture; treat missing bits as non-executable.
        (before[path]?.executable ?? false) !== (after[path]?.executable ?? false),
    )
    .sort();
  const criticalForbidden = changedPaths.length > 0;
  return {
    kind: 'ordinary-project-files-unchanged',
    outcome: criticalForbidden ? 'failed' : 'passed',
    criticalForbidden,
    changedPaths,
    allowedPrefixes: [...allowedPrefixes],
  };
}
