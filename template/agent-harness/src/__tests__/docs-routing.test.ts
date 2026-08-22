import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import { routeDocumentation } from '../lib/docs-routing.js';
import { sourceHarnessRoot } from './helpers/harness.js';

const docsRoot = join(sourceHarnessRoot, 'docs');

test('documentation routing accepts canonical Chinese task aliases', () => {
  const report = routeDocumentation(docsRoot, ['评审']);
  assert.deepEqual(
    report.routes.map(({ name }) => name),
    ['review'],
  );
});

test('documentation routing rejects trigger substrings inside unrelated words', () => {
  assert.deepEqual(routeDocumentation(docsRoot, ['digital']).routes, []);
});
