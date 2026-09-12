import { globSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { SourceFile } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import {
  callScopes,
  commandUnit,
  directlyMutatesFilesystem,
  isWithin,
  moduleSpecifiers,
  normalizeArchitecturePath,
  sourceArea,
  TASK_COMPLETION_GATE,
  TASK_PERSISTENCE_CALLS,
  WORK_STATE_COMMAND,
} from './preflight-architecture-ast.js';

type Check = (condition: unknown, message: string) => void;

export { normalizeArchitecturePath } from './preflight-architecture-ast.js';

/**
 * Frozen cross-area import graph of `packages/cli/src`. Adding an edge requires editing this list,
 * which is where the layering question belongs; removing one is expected as the graph is untangled.
 */
export const declaredCliAreaImports: readonly string[] = [
  '(root) -> app',
  '(root) -> application',
  '(root) -> shared',
  'adapters -> installation',
  'adapters -> shared',
  'adoption -> installation',
  'adoption -> presentation',
  'adoption -> shared',
  'app -> shared',
  'application -> adapters',
  'application -> adoption',
  'application -> app',
  'application -> diagnostics',
  'application -> installation',
  'application -> portable-config',
  'application -> presentation',
  'application -> setup',
  'application -> shared',
  'application -> status',
  'diagnostics -> installation',
  'diagnostics -> shared',
  'diagnostics -> status',
  'installation -> adapters',
  'installation -> shared',
  'installation -> status',
  'installation -> temporary-resources',
  'portable-config -> adoption',
  'portable-config -> installation',
  'portable-config -> shared',
  'presentation -> adoption',
  'presentation -> setup',
  'presentation -> shared',
  'presentation -> status',
  'setup -> installation',
  'setup -> presentation',
  'setup -> shared',
  'shared -> adapters',
  'status -> installation',
  'status -> setup',
  'status -> shared',
  'temporary-resources -> shared',
];

interface OpenedSources {
  relativePaths: string[];
  sources: Map<string, SourceFile | undefined>;
}

function openSources(sourceRoot: string, patterns: string[]): OpenedSources {
  const relativePaths = globSync(patterns, { cwd: sourceRoot })
    .map(normalizeArchitecturePath)
    .filter((path) => !path.includes('__tests__/'))
    .sort();
  const sources = new Map<string, SourceFile | undefined>();
  if (relativePaths.length === 0) return { relativePaths, sources };
  const api = new API({ cwd: sourceRoot });
  try {
    const paths = relativePaths.map((path) => join(sourceRoot, path));
    const snapshot = api.updateSnapshot({ openFiles: paths });
    for (const [index, path] of paths.entries()) {
      sources.set(
        relativePaths[index],
        snapshot.getDefaultProjectForFile(path)?.program.getSourceFile(path),
      );
    }
  } finally {
    api.close();
  }
  return { relativePaths, sources };
}

/**
 * The cross-area import graph of a package, as `area -> area` edges. Reported rather than ranked:
 * `packages/cli/src` has mutual dependencies today, so the contract freezes the current graph and
 * fails on any new edge instead of asserting a layer order the code does not yet satisfy.
 */
function areaImportEdges(sourceRoot: string): string[] {
  const { relativePaths, sources } = openSources(sourceRoot, ['**/*.ts']);
  const edges = new Set<string>();
  for (const relativePath of relativePaths) {
    const source = sources.get(relativePath);
    if (!source) continue;
    const area = sourceArea(relativePath);
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = relative(
        sourceRoot,
        resolve(dirname(join(sourceRoot, relativePath)), specifier),
      );
      if (target.startsWith('..')) continue;
      const targetArea = sourceArea(target);
      if (targetArea !== area) edges.add(`${area} -> ${targetArea}`);
    }
  }
  return [...edges].sort();
}

export function checkAreaImportEdges(
  sourceRoot: string,
  declared: readonly string[],
  check: Check,
): void {
  const actual = areaImportEdges(sourceRoot);
  if (actual.length === 0) {
    check(false, `${sourceRoot}: area boundary check found no sources`);
    return;
  }
  const undeclared = actual.filter((edge) => !declared.includes(edge));
  const stale = declared.filter((edge) => !actual.includes(edge));
  for (const edge of undeclared)
    check(false, `${sourceRoot}: undeclared cross-area import: ${edge}`);
  for (const edge of stale)
    check(false, `${sourceRoot}: declared cross-area import no longer exists: ${edge}`);
  if (undeclared.length + stale.length === 0)
    check(true, `${sourceRoot} cross-area imports match the declared graph`);
}

/** Task completion must pass the acceptance gate before any call that persists the record. */
function completionGateFailures(
  relativePath: string,
  source: SourceFile,
): { messages: string[]; gateCalls: number; persistenceCalls: number } {
  const messages: string[] = [];
  let gateCalls = 0;
  let persistenceCalls = 0;
  for (const scope of callScopes(source)) {
    const gate = scope.calls.indexOf(TASK_COMPLETION_GATE);
    if (gate >= 0) gateCalls += 1;
    const persistence = scope.calls.findIndex((call) => TASK_PERSISTENCE_CALLS.has(call));
    if (persistence >= 0) persistenceCalls += 1;
    if (!scope.comparesCompletion || persistence < 0 || scope.gateInScopeChain) continue;
    if (gate < 0 || gate > persistence)
      messages.push(
        `${relativePath}: task completion must call ${TASK_COMPLETION_GATE} before persistence`,
      );
  }
  return { messages, gateCalls, persistenceCalls };
}

function commandImportFailures(
  sourceRoot: string,
  relativePath: string,
  source: SourceFile,
): string[] {
  const commandsRoot = join(sourceRoot, 'commands');
  const messages: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(join(sourceRoot, relativePath)), specifier);
    if (!isWithin(commandsRoot, target)) continue;
    if (!relativePath.startsWith('commands/')) {
      messages.push(`${relativePath}: lib must not import commands: ${specifier}`);
      continue;
    }
    // A command is free to import its own modules; only reaching into another command's directory
    // couples two commands together.
    const targetUnit = commandUnit(normalizeArchitecturePath(relative(sourceRoot, target)));
    if (targetUnit === commandUnit(relativePath)) continue;
    messages.push(`${relativePath}: commands must not import sibling commands: ${specifier}`);
  }
  return messages;
}

export function checkArchitectureImports(sourceRoot: string, check: Check): void {
  const { relativePaths, sources } = openSources(sourceRoot, ['lib/**/*.ts', 'commands/**/*.ts']);
  // A missing source root globs to nothing, which silently turned every rule below into a pass.
  if (relativePaths.length === 0) {
    check(false, `${sourceRoot}: architecture check found no lib or commands sources`);
    return;
  }
  const failures: string[] = [];
  let completionGateCalls = 0;
  let taskPersistenceCalls = 0;
  for (const relativePath of relativePaths) {
    const source = sources.get(relativePath);
    if (!source) {
      failures.push(`${relativePath}: TypeScript could not parse source`);
      continue;
    }
    if (relativePath.startsWith('commands/')) {
      const gate = completionGateFailures(relativePath, source);
      failures.push(...gate.messages);
      completionGateCalls += gate.gateCalls;
      taskPersistenceCalls += gate.persistenceCalls;
    }
    failures.push(...commandImportFailures(sourceRoot, relativePath, source));
    if (
      relativePath.startsWith('commands/') &&
      WORK_STATE_COMMAND.test(relativePath.slice(9)) &&
      directlyMutatesFilesystem(source)
    )
      failures.push(
        `${relativePath}: typed work-state commands must not perform direct filesystem mutation`,
      );
  }
  // Without this the invariant disappears the moment the completion path is renamed or moved: the
  // previous spelling of this check pinned `commands/task.ts`, which no longer exists.
  if (taskPersistenceCalls > 0 && completionGateCalls === 0)
    failures.push(`commands: no command calls the task completion gate ${TASK_COMPLETION_GATE}`);
  for (const failure of failures) check(false, failure);
  if (failures.length === 0) check(true, 'Harness source architecture imports are valid');
}
