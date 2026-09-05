import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('prompt guidance routes authorization blockers through host HITL and resumes safely', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const toolRouting = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'tool-routing.md'),
    'utf8',
  );
  const rules = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'prompt-rules.yaml'),
    'utf8',
  );
  const manifest = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );
  const boundaries = readFileSync(
    join(root, 'apps', 'docs', 'site', 'zh', 'concepts', 'boundaries.md'),
    'utf8',
  );

  const guidance = [agents, toolRouting].join('\n');
  assert.match(guidance, /approval|question|ask-user|elicitation/i);
  assert.match(guidance, /approved.*exact|精确动作|当前动作/s);
  assert.match(guidance, /denied|cancelled|timeout|blocked/s);
  assert.match(guidance, /工具.*不存在|工具.*不可用|宿主.*没有/s);
  assert.match(guidance, /Memory|记忆/);
  assert.doesNotMatch(guidance, /调用\s*user-input|调用 `user-input`/i);
  assert.match(boundaries, /精确动作.*决定|denied.*cancelled.*timeout/s);
  assert.match(boundaries, /nextAction/);

  assert.match(rules, /id: host-approval-continuation/);
  assert.match(rules, /id: host-approval-continuation[\s\S]*guarantee: host-dependent/);
  assert.match(rules, /id: host-approval-continuation[\s\S]*enforcedBy: host/);
  assert.match(manifest, /tool-routing:[\s\S]*approval[\s\S]*question[\s\S]*elicitation/);
});

test('multilingual routing rule does not claim runtime control of host responses', () => {
  const rules = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'prompt-rules.yaml'),
    'utf8',
  );
  const rule = rules.match(
    / {2}- id: multilingual-routing-and-response[\s\S]*?(?=\n {2}- id:|\s*$)/u,
  )?.[0];
  assert.ok(rule, 'multilingual routing rule must exist');
  assert.match(rule, /guarantee: guided/);
  assert.match(rule, /enforcedBy: agent/);
  assert.match(rule, /boundary:/);
});
