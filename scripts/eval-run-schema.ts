import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { evalAdapterEnum } from '../src/adapter-registry.js';

export type EvalRunSchema = {
  properties?: {
    host?: {
      properties?: {
        adapter?: {
          enum?: unknown;
        };
      };
    };
  };
};

export const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Matches the compact `host.adapter.enum` object in evals/run.schema.json. */
const hostAdapterEnumPattern = /("adapter"\s*:\s*\{\s*"enum"\s*:\s*)\[[^\]]*\]/;

export function evalRunSchemaPath(root: string = repositoryRoot): string {
  return join(root, 'evals', 'run.schema.json');
}

/** Patch only `host.adapter.enum`; leave every other field untouched. */
export function applyEvalAdapterEnum(
  schema: EvalRunSchema,
  adapters: readonly string[] = evalAdapterEnum(),
): EvalRunSchema {
  const next = structuredClone(schema) as EvalRunSchema;
  const adapter = next.properties?.host?.properties?.adapter;
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('evals/run.schema.json is missing properties.host.properties.adapter');
  }
  adapter.enum = [...adapters];
  return next;
}

export function readEvalAdapterEnum(schema: EvalRunSchema): unknown {
  return schema.properties?.host?.properties?.adapter?.enum;
}

export function evalAdapterEnumsMatch(
  actual: unknown,
  expected: readonly string[] = evalAdapterEnum(),
): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/** Rewrite only the adapter enum array text so compact schema formatting stays intact. */
export function rewriteEvalAdapterEnumSource(
  source: string,
  adapters: readonly string[] = evalAdapterEnum(),
): string {
  if (!hostAdapterEnumPattern.test(source)) {
    throw new Error('evals/run.schema.json is missing a host.adapter.enum array to rewrite');
  }
  const nextEnum = JSON.stringify([...adapters]);
  return source.replace(hostAdapterEnumPattern, `$1${nextEnum}`);
}

export function checkEvalRunSchemaAdapterEnum(
  root: string = repositoryRoot,
  expected: readonly string[] = evalAdapterEnum(),
): { ok: true; expected: string[] } | { ok: false; expected: string[]; actual: unknown } {
  const path = evalRunSchemaPath(root);
  if (!existsSync(path)) {
    return { ok: false, expected: [...expected], actual: undefined };
  }
  const schema = JSON.parse(readFileSync(path, 'utf8')) as EvalRunSchema;
  const actual = readEvalAdapterEnum(schema);
  if (evalAdapterEnumsMatch(actual, expected)) {
    return { ok: true, expected: [...expected] };
  }
  return { ok: false, expected: [...expected], actual };
}

export function generateEvalRunSchemaAdapterEnum(
  root: string = repositoryRoot,
  expected: readonly string[] = evalAdapterEnum(),
): { changed: boolean; path: string; expected: string[] } {
  const path = evalRunSchemaPath(root);
  if (!existsSync(path)) {
    throw new Error(`evals/run.schema.json is missing at ${path}`);
  }
  const before = readFileSync(path, 'utf8');
  const schema = JSON.parse(before) as EvalRunSchema;
  if (evalAdapterEnumsMatch(readEvalAdapterEnum(schema), expected)) {
    return { changed: false, path, expected: [...expected] };
  }
  const after = rewriteEvalAdapterEnumSource(before, expected);
  const rewritten = JSON.parse(after) as EvalRunSchema;
  if (!evalAdapterEnumsMatch(readEvalAdapterEnum(rewritten), expected)) {
    throw new Error('failed to rewrite evals/run.schema.json host.adapter.enum from the registry');
  }
  writeFileSync(path, after);
  return { changed: true, path, expected: [...expected] };
}

function main(): void {
  const program = new Command()
    .name('eval-run-schema')
    .description(
      'Generate or check evals/run.schema.json host.adapter.enum from the adapter registry',
    )
    .showHelpAfterError();

  program
    .command('generate')
    .description('rewrite host.adapter.enum from the adapter registry')
    .option('--root <path>', 'repository root', repositoryRoot)
    .action(({ root }: { root: string }) => {
      const result = generateEvalRunSchemaAdapterEnum(resolve(root));
      if (result.changed) {
        console.log(`Updated ${result.path} host.adapter.enum → ${result.expected.join(', ')}`);
      } else {
        console.log(`Unchanged ${result.path} host.adapter.enum (${result.expected.join(', ')})`);
      }
    });

  program
    .command('check')
    .description('fail when host.adapter.enum drifts from the adapter registry')
    .option('--root <path>', 'repository root', repositoryRoot)
    .action(({ root }: { root: string }) => {
      const result = checkEvalRunSchemaAdapterEnum(resolve(root));
      if (result.ok) {
        console.log(
          `evals/run.schema.json host.adapter.enum matches adapter registry (${result.expected.join(', ')})`,
        );
        return;
      }
      console.error(
        `evals/run.schema.json host.adapter.enum must match adapter registry: ${result.expected.join(', ')}`,
      );
      console.error(`actual: ${JSON.stringify(result.actual)}`);
      process.exitCode = 1;
    });

  program.parse();
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
