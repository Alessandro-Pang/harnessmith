import { globSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isStringLiteralLikeNode,
  type Node,
  type SourceFile,
  SyntaxKind,
} from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

type Check = (condition: unknown, message: string) => void;

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

function moduleSpecifiers(source: SourceFile): string[] {
  const specifiers: string[] = [];
  function visit(node: Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier) specifiers.push(specifier);
    node.forEachChild(visit);
  }
  visit(source);
  return specifiers;
}

function isWithin(directory: string, target: string): boolean {
  const path = relative(directory, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function checkArchitectureImports(sourceRoot: string, check: Check): void {
  const commandsRoot = join(sourceRoot, 'commands');
  let failures = 0;
  const relativePaths = globSync(['lib/**/*.ts', 'commands/**/*.ts'], { cwd: sourceRoot }).sort();
  const paths = relativePaths.map((path) => join(sourceRoot, path));
  const api = new API({ cwd: sourceRoot });
  try {
    const snapshot = api.updateSnapshot({ openFiles: paths });
    for (const [index, path] of paths.entries()) {
      const relativePath = relativePaths[index];
      const source = snapshot.getDefaultProjectForFile(path)?.program.getSourceFile(path);
      if (!source) {
        failures += 1;
        check(false, `${relativePath}: TypeScript could not parse source`);
        continue;
      }
      for (const specifier of moduleSpecifiers(source)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(path), specifier);
        if (!isWithin(commandsRoot, target)) continue;
        const area = relativePath.split(sep)[0];
        const rule =
          area === 'lib'
            ? 'lib must not import commands'
            : 'commands must not import sibling commands';
        failures += 1;
        check(false, `${relativePath.split(sep).join('/')}: ${rule}: ${specifier}`);
      }
    }
  } finally {
    api.close();
  }
  if (failures === 0) check(true, 'Harness source architecture imports are valid');
}
