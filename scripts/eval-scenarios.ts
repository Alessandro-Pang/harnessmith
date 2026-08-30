import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep, win32 } from 'node:path';
import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

type ScenarioContract = {
  automatedChecks: string[];
  dependencyPaths: string[];
  forbidden: string[];
  id: string;
  pass: string[];
  prompt: string;
  setup: string[];
};

export type ScenarioCatalog = { schemaVersion: 3; scenarios: ScenarioContract[] };

function parseJson<T>(content: Buffer, name: string): T {
  try {
    return JSON.parse(content.toString('utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in candidate npm package ${name}: ${message}`);
  }
}

export function readScenarioCatalog(content: Buffer, schemaContent: Buffer): ScenarioCatalog {
  const schema = parseJson<AnySchema>(schemaContent, 'evals/scenarios.schema.json');
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const catalog = parseJson<unknown>(content, 'evals/scenarios.json');
  if (!validate(catalog)) {
    throw new Error(
      `Candidate evaluation scenarios violate schema: ${JSON.stringify(validate.errors)}`,
    );
  }
  const typedCatalog = catalog as ScenarioCatalog;
  const ids = typedCatalog.scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Candidate evaluation scenario ids must be unique');
  }
  return typedCatalog;
}

export function worktreeScenarioCatalog(repositoryRoot: string): ScenarioCatalog {
  return readScenarioCatalog(
    readFileSync(join(repositoryRoot, 'evals', 'scenarios.json')),
    readFileSync(join(repositoryRoot, 'evals', 'scenarios.schema.json')),
  );
}

function dependencyFile(repositoryRoot: string, path: string): Buffer {
  if (
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`Unsafe evaluation dependency path: ${path}`);
  }
  const absolute = join(repositoryRoot, path);
  const repositoryRelative = relative(repositoryRoot, absolute);
  if (repositoryRelative.startsWith(`..${sep}`) || repositoryRelative === '..') {
    throw new Error(`Evaluation dependency escapes repository: ${path}`);
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Evaluation dependency must be a regular file: ${path}`);
  }
  return readFileSync(absolute);
}

export function scenarioDependencyFingerprints(
  catalog: ScenarioCatalog,
  repositoryRoot: string,
): Record<string, string> {
  return Object.fromEntries(
    catalog.scenarios.map(({ dependencyPaths, id }) => {
      const hash = createHash('sha256');
      for (const path of [...dependencyPaths].sort()) {
        hash.update(path).update('\0').update(dependencyFile(repositoryRoot, path)).update('\0');
      }
      return [id, hash.digest('hex')];
    }),
  );
}
