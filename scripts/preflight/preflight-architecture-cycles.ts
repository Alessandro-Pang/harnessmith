import { globSync } from 'node:fs';
import { areaImportEdges } from './preflight-architecture.js';

type Check = (condition: unknown, message: string) => void;

function areaImportCycles(sourceRoot: string): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of areaImportEdges(sourceRoot)) {
    const separator = edge.indexOf(' -> ');
    const source = edge.slice(0, separator);
    const target = edge.slice(separator + 4);
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)?.add(target);
  }

  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(area: string): void {
    indexes.set(area, nextIndex);
    lowLinks.set(area, nextIndex);
    nextIndex += 1;
    stack.push(area);
    onStack.add(area);

    for (const target of adjacency.get(area) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(area, Math.min(lowLinks.get(area) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(area, Math.min(lowLinks.get(area) ?? 0, indexes.get(target) ?? 0));
      }
    }

    if (lowLinks.get(area) !== indexes.get(area)) return;
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current === undefined) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== area);
    if (component.length > 1) components.push(component.sort());
  }

  for (const area of adjacency.keys()) if (!indexes.has(area)) visit(area);
  return components.sort((left, right) => left.join().localeCompare(right.join()));
}

function cycleKey(component: readonly string[]): string {
  return [...component].sort().join(' -> ');
}

export function checkAreaImportCycles(
  sourceRoot: string,
  declared: readonly (readonly string[])[],
  check: Check,
): void {
  const relativePaths = globSync(['**/*.ts'], { cwd: sourceRoot }).filter(
    (path) => !path.includes('__tests__/'),
  );
  if (relativePaths.length === 0) {
    check(false, `${sourceRoot}: area cycle check found no sources`);
    return;
  }

  const actualKeys = new Set(areaImportCycles(sourceRoot).map(cycleKey));
  const declaredKeys = new Set(declared.map(cycleKey));
  for (const cycle of actualKeys) {
    if (!declaredKeys.has(cycle)) check(false, `${sourceRoot}: new cross-area cycle: ${cycle}`);
  }
  for (const cycle of declaredKeys) {
    if (!actualKeys.has(cycle))
      check(false, `${sourceRoot}: declared cross-area cycle no longer exists: ${cycle}`);
  }
  if (
    [...actualKeys].every((cycle) => declaredKeys.has(cycle)) &&
    [...declaredKeys].every((cycle) => actualKeys.has(cycle))
  )
    check(true, `${sourceRoot} cross-area cycles match the declared baseline`);
}
