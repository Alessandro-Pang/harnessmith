import { isAbsolute, relative, sep } from 'node:path';
import {
  isBinaryExpression,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isFunctionLikeDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isPropertyAccessExpression,
  isStringLiteral,
  isStringLiteralLikeNode,
  type Node,
  type SourceFile,
  SyntaxKind,
} from 'typescript/unstable/ast';

export const TASK_COMPLETION_GATE = 'assertTaskCanComplete';
export const TASK_PERSISTENCE_CALLS = new Set(['checkpointTaskAtRoot', 'writeTask']);
export const WORK_STATE_COMMAND = /^(?:memory(?:-|\.)|task(?:-|\.))/;

const MUTATING_FS_APIS = new Set([
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'mkdir',
  'mkdirSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
]);

function moduleSpecifier(node: Node): string | undefined {
  if (isImportDeclaration(node) || isExportDeclaration(node)) {
    return node.moduleSpecifier && isStringLiteralLikeNode(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }
  if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && isStringLiteralLikeNode(expression) ? expression.text : undefined;
  }
  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    return argument && isStringLiteralLikeNode(argument) ? argument.text : undefined;
  }
  return undefined;
}

export function moduleSpecifiers(source: SourceFile): string[] {
  const specifiers: string[] = [];
  function visit(node: Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier) specifiers.push(specifier);
    node.forEachChild(visit);
  }
  visit(source);
  return specifiers;
}

export function directlyMutatesFilesystem(source: SourceFile): boolean {
  if (
    !moduleSpecifiers(source).some(
      (specifier) => specifier === 'node:fs' || specifier === 'node:fs/promises',
    )
  )
    return false;
  let mutates = false;
  function visit(node: Node): void {
    if (isIdentifier(node) && MUTATING_FS_APIS.has(node.text)) mutates = true;
    if (!mutates) node.forEachChild(visit);
  }
  visit(source);
  return mutates;
}

/** A function body, with its calls in source order and whether it branches on task completion. */
export interface CallScope {
  calls: string[];
  comparesCompletion: boolean;
  gateInScopeChain: boolean;
}

function calledName(node: Node): string | undefined {
  if (!isCallExpression(node)) return undefined;
  if (isIdentifier(node.expression)) return node.expression.text;
  return isPropertyAccessExpression(node.expression) && isIdentifier(node.expression.name)
    ? node.expression.name.text
    : undefined;
}

function comparesTaskCompletion(node: Node): boolean {
  if (!isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator !== SyntaxKind.EqualsEqualsEqualsToken && operator !== SyntaxKind.EqualsEqualsToken)
    return false;
  return [node.left, node.right].some((side) => isStringLiteral(side) && side.text === 'complete');
}

/**
 * Collect one scope per function body. Text offsets would let a rename or a reformat silently
 * disable the completion invariant, so both the branch and the call order come from the AST.
 */
export function callScopes(source: SourceFile): CallScope[] {
  const scopes: CallScope[] = [];
  function visit(node: Node, scope: CallScope): void {
    let current = scope;
    if (isFunctionLikeDeclaration(node)) {
      current = {
        calls: [],
        comparesCompletion: false,
        gateInScopeChain: scope.gateInScopeChain || scope.calls.includes(TASK_COMPLETION_GATE),
      };
      scopes.push(current);
    }
    const call = calledName(node);
    if (call) current.calls.push(call);
    if (comparesTaskCompletion(node)) current.comparesCompletion = true;
    node.forEachChild((child) => visit(child, current));
  }
  const module: CallScope = { calls: [], comparesCompletion: false, gateInScopeChain: false };
  scopes.push(module);
  visit(source, module);
  return scopes;
}

export function isWithin(directory: string, target: string): boolean {
  const path = relative(directory, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function normalizeArchitecturePath(path: string): string {
  return path.replaceAll('\\', '/');
}

/** The command a path belongs to: a directory under `commands/`, or a single-file command. */
export function commandUnit(relativePath: string): string {
  const segments = normalizeArchitecturePath(relativePath).split('/');
  return segments.length > 2
    ? `${segments[0]}/${segments[1]}`
    : normalizeArchitecturePath(relativePath).replace(/\.[cm]?[jt]s$/u, '');
}

export function sourceArea(relativePath: string): string {
  const [area] = normalizeArchitecturePath(relativePath).split('/');
  return area.endsWith('.ts') ? '(root)' : area;
}
