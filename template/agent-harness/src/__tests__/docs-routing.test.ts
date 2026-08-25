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

test.each([
  'multi-stage task with verified phase',
  'context budget compaction',
  '多阶段任务，阶段已验证仍有后续',
  '上下文预算信号',
])('documentation routing reaches staged handoff guidance for %s', (query) => {
  const routes = routeDocumentation(docsRoot, [query]).routes.map(({ name }) => name);
  assert.ok(routes.includes('long-running-tasks'), `${query} did not route to long-running-tasks`);
  assert.ok(routes.includes('project-agent-docs'), `${query} did not route to project-agent-docs`);
});
