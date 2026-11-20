import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** @param {string | Buffer} content */
export function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} path
 * @param {number} [maxBytes]
 * @returns {import('../support/types.mjs').SafeReadState}
 */
export function safeReadFile(path, maxBytes = 2 * 1024 * 1024) {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      return { ok: false, path, error: 'not a regular non-symlink file' };
    }
    if (entry.size > maxBytes) {
      return { ok: false, path, error: `file exceeds ${maxBytes} bytes`, size: entry.size };
    }
    const content = readFileSync(path);
    return {
      ok: true,
      path,
      size: content.length,
      sha256: digest(content),
      content,
      text: content.toString('utf8'),
    };
  } catch (error) {
    return { ok: false, path, error: String(error) };
  }
}

/**
 * @param {string} root
 * @param {{ excludeGit?: boolean, maxFiles?: number }} [options]
 * @returns {import('../support/types.mjs').RuntimeTreeSnapshot}
 */
export function treeSnapshot(root, { excludeGit = false, maxFiles = 20_000 } = {}) {
  /** @type {Record<string, import('../support/types.mjs').RuntimeTreeEntry>} */
  const entries = {};
  /** @type {string[]} */
  const errors = [];
  let files = 0;

  /** @param {string} path @param {string} [relativePath] */
  function visit(path, relativePath = '') {
    if (files >= maxFiles) {
      errors.push(`tree file budget exceeded at ${relativePath || '.'}`);
      return;
    }
    let entry;
    try {
      entry = lstatSync(path);
    } catch (error) {
      errors.push(`${relativePath || '.'}: ${String(error)}`);
      return;
    }
    if (!relativePath) {
      entries['.'] = {
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        mode: entry.mode & 0o777,
      };
    }
    if (relativePath && recordNonDirectory(path, relativePath, entry)) return;
    let children;
    try {
      children = readdirSync(path, { withFileTypes: true });
    } catch (error) {
      errors.push(`${relativePath || '.'}: ${String(error)}`);
      return;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relativePath ? `${relativePath}/${child.name}` : child.name;
      if (excludeGit && childRelative.split('/').includes('.git')) continue;
      visit(join(path, child.name), childRelative);
    }
  }

  /**
   * @param {string} path
   * @param {string} relativePath
   * @param {import('node:fs').Stats} entry
   */
  function recordNonDirectory(path, relativePath, entry) {
    if (entry.isSymbolicLink()) {
      try {
        entries[relativePath] = { type: 'symlink', target: readlinkSync(path) };
      } catch (error) {
        entries[relativePath] = { type: 'symlink', error: String(error) };
        errors.push(`${relativePath}: ${String(error)}`);
      }
      files += 1;
      return true;
    }
    if (entry.isFile()) {
      const state = safeReadFile(path, 4 * 1024 * 1024);
      entries[relativePath] = state.ok
        ? { type: 'file', size: state.size, sha256: state.sha256, mode: entry.mode & 0o777 }
        : { type: 'file', size: entry.size, error: state.error, mode: entry.mode & 0o777 };
      if (!state.ok) errors.push(`${relativePath}: ${state.error}`);
      files += 1;
      return true;
    }
    if (!entry.isDirectory()) {
      entries[relativePath] = { type: 'other', mode: entry.mode & 0o777 };
      files += 1;
      return true;
    }
    entries[relativePath] = { type: 'directory', mode: entry.mode & 0o777 };
    return false;
  }

  if (!existsSync(root)) {
    return { root, exists: false, entries, errors, digest: digest('missing') };
  }
  visit(root);
  return { root, exists: true, entries, errors, digest: digest(JSON.stringify(entries)) };
}

/**
 * @param {import('../support/types.mjs').RuntimeTreeSnapshot | undefined} beforeTree
 * @param {import('../support/types.mjs').RuntimeTreeSnapshot | undefined} afterTree
 */
export function treeChangedPaths(beforeTree, afterTree) {
  const names = new Set([
    ...Object.keys(beforeTree?.entries ?? {}),
    ...Object.keys(afterTree?.entries ?? {}),
  ]);
  return [...names]
    .filter(
      (name) =>
        JSON.stringify(beforeTree?.entries?.[name] ?? null) !==
        JSON.stringify(afterTree?.entries?.[name] ?? null),
    )
    .sort();
}

/** @param {string} path @param {string} root */
export function pathWithin(path, root) {
  const candidate = resolve(path);
  const boundary = resolve(root);
  const relation = relative(boundary, candidate);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

/** @param {string[]} evaluatorErrors */
export function createMarkdownFileFinder(evaluatorErrors) {
  /** @param {string} directory @returns {string[]} */
  function markdownFiles(directory) {
    if (!existsSync(directory)) return [];
    try {
      const rootEntry = lstatSync(directory);
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
        evaluatorErrors.push(`refusing non-directory or symlink Markdown root at ${directory}`);
        return [];
      }
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return markdownFiles(path);
        return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
      });
    } catch (error) {
      evaluatorErrors.push(`cannot enumerate Markdown files at ${directory}: ${String(error)}`);
      return [];
    }
  }
  return markdownFiles;
}

/** @param {unknown} value @returns {unknown} */
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

/** @param {{ title: string, kind?: string, status?: string, body: string, extra?: string }} input */
export function memoryDoc({ title, kind = 'episode', status = 'active', body, extra = '' }) {
  return `---\ntitle: ${title}\ndescription: Disposable host evaluation memory.\ntype: ${kind}-memory\nmemory-kind: ${kind}\nstatus: ${status}\nowners: ["eval"]\ncreated: "2026-08-24"\nupdated: "2026-08-24"\nproject: "host-eval"\ntags: ["host-eval"]\nscope: ["packages/cli/src"]\nsource-refs: ["docs/architecture.md"]\nsource-of-truth: false\nschema-version: 1\nconfidence: high\n${extra}---\n\n${body}\n`;
}
