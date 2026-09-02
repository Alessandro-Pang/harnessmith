import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readlinkSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function exactJsonObject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createScenarioRuntime(context) {
  const { repo, repository, candidate, packageRoot } = context;
  function fileDigest(path) {
    const state = safeReadFile(path, 8 * 1024 * 1024);
    return state.ok ? state.sha256 : null;
  }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repo,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 24 * 1024 * 1024,
    timeout: options.timeout ?? 240_000,
    killSignal: 'SIGKILL',
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
  };
}

function checked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error}`);
  }
  return result;
}

function assertCleanroomMatchesCandidate() {
  const entries = checked('tar', ['-tzf', candidate], { cwd: repository }).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  for (const entry of entries) {
    if (!entry.startsWith('package/') || entry.endsWith('/')) {
      throw new Error(`unexpected candidate tar entry: ${entry}`);
    }
    const packagePath = entry.slice('package/'.length);
    if (!packagePath || packagePath.split('/').includes('..')) {
      throw new Error(`unsafe candidate tar entry: ${entry}`);
    }
    const installedPath = join(packageRoot, packagePath);
    if (!existsSync(installedPath)) {
      throw new Error(`clean-room package is missing candidate entry: ${packagePath}`);
    }
    const extracted = spawnSync('tar', ['-xOf', candidate, entry], {
      cwd: repository,
      encoding: null,
      maxBuffer: 24 * 1024 * 1024,
    });
    if (extracted.status !== 0 || !Buffer.isBuffer(extracted.stdout)) {
      throw new Error(`cannot read candidate tar entry: ${entry}`);
    }
    if (digest(extracted.stdout) !== fileDigest(installedPath)) {
      throw new Error(`clean-room package differs from candidate entry: ${packagePath}`);
    }
  }
}

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeReadFile(path, maxBytes = 2 * 1024 * 1024) {
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

function treeSnapshot(root, { excludeGit = false, maxFiles = 20_000 } = {}) {
  const entries = {};
  const errors = [];
  let files = 0;
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
    if (relativePath) {
      if (entry.isSymbolicLink()) {
        try {
          entries[relativePath] = { type: 'symlink', target: readlinkSync(path) };
        } catch (error) {
          entries[relativePath] = { type: 'symlink', error: String(error) };
          errors.push(`${relativePath}: ${String(error)}`);
        }
        files += 1;
        return;
      }
      if (entry.isFile()) {
        const state = safeReadFile(path, 4 * 1024 * 1024);
        entries[relativePath] = state.ok
          ? { type: 'file', size: state.size, sha256: state.sha256, mode: entry.mode & 0o777 }
          : { type: 'file', size: entry.size, error: state.error, mode: entry.mode & 0o777 };
        if (!state.ok) errors.push(`${relativePath}: ${state.error}`);
        files += 1;
        return;
      }
      if (!entry.isDirectory()) {
        entries[relativePath] = { type: 'other', mode: entry.mode & 0o777 };
        files += 1;
        return;
      }
      entries[relativePath] = { type: 'directory', mode: entry.mode & 0o777 };
    }
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
  if (!existsSync(root)) {
    return { root, exists: false, entries, errors, digest: digest('missing') };
  }
  visit(root);
  const serialized = JSON.stringify(entries);
  return {
    root,
    exists: true,
    entries,
    errors,
    digest: digest(serialized),
  };
}

function treeChangedPaths(beforeTree, afterTree) {
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

function pathWithin(path, root) {
  const candidate = resolve(path);
  const boundary = resolve(root);
  const relation = relative(boundary, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

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

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function git(args, cwd = repo) {
  return checked('git', args, { cwd });
}

function gitCommit(cwd = repo) {
  git(['add', '-A'], cwd);
  const staged = run('git', ['diff', '--cached', '--quiet'], { cwd });
  if (staged.status === 1) {
    checked(
      'git',
      ['-c', 'user.name=Harness-Eval', '-c', 'user.email=eval@example.invalid', 'commit', '-m', 'test: evaluation setup'],
      { cwd },
    );
  }
}

function memoryDoc({ title, kind = 'episode', status = 'active', body, extra = '' }) {
  return `---\ntitle: ${title}\ndescription: Disposable host evaluation memory.\ntype: ${kind}-memory\nmemory-kind: ${kind}\nstatus: ${status}\nowners: [\"eval\"]\ncreated: \"2026-08-24\"\nupdated: \"2026-08-24\"\nproject: \"host-eval\"\ntags: [\"host-eval\"]\nscope: [\"src\"]\nsource-refs: [\"docs/architecture.md\"]\nsource-of-truth: false\nschema-version: 1\nconfidence: high\n${extra}---\n\n${body}\n`;
}

  return { run, checked, assertCleanroomMatchesCandidate, write, digest, safeReadFile, treeSnapshot, treeChangedPaths, pathWithin, markdownFiles, canonicalJson, exactJsonObject, git, gitCommit, memoryDoc };
}
