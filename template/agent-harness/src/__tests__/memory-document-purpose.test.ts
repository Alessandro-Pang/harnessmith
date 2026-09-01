import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { memoryCheck } from '../commands/memory.js';
import { captureFinding } from '../commands/memory-finding.js';
import {
  analyzeDocumentPurpose,
  documentPurposeMetadata,
  validateDocumentPurpose,
} from '../lib/memory-document-purpose.js';
import { memoryMaintenanceReport, memoryMaintenanceWarnings } from '../lib/memory-maintenance.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-document-purpose-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  return { project, runtime, memoryRoot: join(project, '.agent-docs') };
}

function legacyDocument(title: string, description: string, body: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: 2026-08-31\nupdated: 2026-08-31\nexpires: 2026-09-30\nproject: project\ntags: [working]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n${body}\n`;
}

test('document purpose metadata is explicit, bounded, and aligned with title and description', () => {
  assert.deepEqual(documentPurposeMetadata('Keep routing intent explicit'), {
    'document-purpose': 'Keep routing intent explicit',
    'document-purpose-schema-version': 1,
  });
  const valid = new Map<string, unknown>([
    ['title', '保持路由意图明确'],
    ['description', '分析发现：保持路由意图明确'],
    ['document-purpose', '保持路由意图明确'],
    ['document-purpose-schema-version', 1],
  ]);
  assert.deepEqual(validateDocumentPurpose(valid), []);

  const invalid = new Map<string, unknown>([
    ['title', 'Task information'],
    ['description', 'Related content'],
    ['document-purpose', 'Different purpose'],
    ['document-purpose-schema-version', 1],
  ]);
  assert.deepEqual(
    validateDocumentPurpose(invalid).map(({ code }) => code),
    [
      'generic-title',
      'generic-description',
      'purpose-title-mismatch',
      'description-title-mismatch',
    ],
  );

  assert.deepEqual(
    validateDocumentPurpose(
      new Map<string, unknown>([
        ['title', 'Bounded purpose'],
        ['description', 'Decision record for Bounded purpose.'],
        ['document-purpose', 'Bounded purpose'],
        ['document-purpose-schema-version', 2],
      ]),
    ).map(({ code }) => code),
    ['invalid-purpose-schema'],
  );
  assert.deepEqual(
    validateDocumentPurpose(
      new Map<string, unknown>([
        ['title', 'Bounded purpose'],
        ['description', 'Decision record for Bounded purpose.'],
        ['document-purpose-schema-version', 1],
      ]),
    ).map(({ code }) => code),
    ['missing-purpose'],
  );
  assert.deepEqual(
    validateDocumentPurpose(
      new Map<string, unknown>([
        ['title', 'Bounded purpose'],
        ['description', 'Decision record for Bounded purpose.'],
        ['document-purpose', 'Bounded\npurpose'],
        ['document-purpose-schema-version', 1],
      ]),
    ).map(({ code }) => code),
    ['invalid-purpose'],
  );
});

test('purpose analysis detects CJK and English multi-purpose legacy documents without rewriting', () => {
  const cjk = analyzeDocumentPurpose(
    new Map([
      ['title', '任务信息'],
      ['description', '相关内容'],
    ]),
    '# 结论\n\n结论一。\n\n# 目的\n\n另一个目的。',
  );
  assert.equal(cjk.genericDescription, true);
  assert.deepEqual(cjk.splitReasons, ['multiple-purpose-headings']);

  const english = analyzeDocumentPurpose(
    new Map([
      ['title', 'Release review'],
      ['description', 'Task information'],
    ]),
    '# Conclusion\n\nOne conclusion.\n\n# Purpose\n\nAnother purpose.',
  );
  assert.equal(english.genericDescription, true);
  assert.deepEqual(english.splitReasons, ['multiple-purpose-headings']);
});

test('new typed writes reject low-information purpose metadata', () => {
  const { project, runtime } = fixture();
  const io = capturedIo();
  assert.throws(
    () =>
      captureFinding(
        runtime,
        project,
        {
          kind: 'analysis',
          retention: 'durable',
          factClass: 'settled-fact',
          title: 'Task information',
          conclusion: 'A generic title cannot identify one reusable purpose.',
          rationale: 'Low-information labels collapse unrelated recall candidates.',
          application: 'Use a specific bounded purpose title.',
          evidence: ['The title uses a rejected English generic label.'],
          sourceRefs: ['docs/purpose-contract.md'],
        },
        io,
      ),
    /memory check failed/i,
  );
  assert.match(io.errors.join('\n'), /generic-title/i);
});

test('maintenance reports duplicate purpose and explainable split proposals', () => {
  const { memoryRoot, project, runtime } = fixture();
  const working = join(memoryRoot, 'working');
  mkdirSync(working, { recursive: true });
  writeFileSync(
    join(working, 'cjk.md'),
    legacyDocument('任务信息', '相关内容', '# 结论\n\n第一件事。\n\n# 目的\n\n第二件事。'),
  );
  writeFileSync(
    join(working, 'english.md'),
    legacyDocument(
      'Release review',
      'Release review captures two unrelated decisions.',
      '# Conclusion\n\nFirst decision.\n\n# Purpose\n\nSecond decision.',
    ),
  );
  writeFileSync(
    join(working, 'one.md'),
    legacyDocument('Stable routing purpose', 'Routing decision for adapters.', '# Body\n\nOne.'),
  );
  writeFileSync(
    join(working, 'two.md'),
    legacyDocument('Stable routing purpose', 'Routing decision for hosts.', '# Body\n\nTwo.'),
  );

  const checkIo = capturedIo();
  memoryCheck(runtime, project, checkIo);
  assert.match(checkIo.errors.join('\n'), /WARNING.*generic-description.*working[\\/]cjk\.md/i);

  const report = memoryMaintenanceReport(memoryRoot, '2026-08-31');
  assert.deepEqual(report.genericDescriptions, ['working/cjk.md']);
  assert.deepEqual(report.duplicatePurposes, [
    {
      purpose: 'Stable routing purpose',
      paths: ['working/one.md', 'working/two.md'],
    },
  ]);
  assert.deepEqual(report.splitProposals, [
    { path: 'working/cjk.md', reasons: ['multiple-purpose-headings'] },
    { path: 'working/english.md', reasons: ['multiple-purpose-headings'] },
  ]);
  const warnings = memoryMaintenanceWarnings(report).join('\n');
  assert.match(warnings, /generic description: working\/cjk\.md/);
  assert.match(warnings, /duplicate purpose: Stable routing purpose/);
  assert.match(warnings, /split proposal: working\/cjk\.md.*multiple-purpose-headings/);
});
