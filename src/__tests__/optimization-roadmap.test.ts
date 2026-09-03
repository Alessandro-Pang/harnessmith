import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

test('optimization roadmap maps every scoped issue to owner boundary evidence and status', () => {
  const roadmap = read('docs/project/optimization-roadmap.md');
  const rows = new Map<number, string[]>();
  for (const line of roadmap.split('\n')) {
    const match = line.match(/^\| \[#(\d+)\]\([^)]+\) \| (.+) \| (.+) \| (.+) \|$/u);
    if (!match) continue;
    rows.set(Number(match[1]), match.slice(2));
  }

  assert.deepEqual(
    [...rows.keys()].sort((left, right) => left - right),
    [...Array.from({ length: 26 }, (_, index) => index + 87)],
  );
  for (const issue of Array.from({ length: 26 }, (_, index) => index + 87)) {
    const row = rows.get(issue);
    assert.ok(row, `missing roadmap row for #${issue}`);
    assert.ok(
      row.every((cell) => cell.trim().length >= 8),
      `incomplete roadmap row for #${issue}`,
    );
  }
  assert.match(roadmap, /#112.*OPEN.*#7.*#9.*#10/s);
  assert.match(
    roadmap,
    /created.*updated.*unchanged.*proposed.*blocked.*not-evaluated.*inconclusive/s,
  );
});

test('optimization roadmap preserves architecture and evidence boundaries', () => {
  const roadmap = read('docs/project/optimization-roadmap.md');
  const config = read('docs/.vitepress/config.ts');

  for (const contract of [
    /不增加第二套 Runtime、Memory ontology、存储协议或状态源/,
    /Memory、Task、Handoff、Evidence.*分离/,
    /managed distribution.*personal overlay.*mutable state.*project sidecar.*分离/s,
    /typed CLI.*schema.*secret scan.*SafePath.*锁.*原子写.*回滚/s,
    /Task complete.*acceptance gate/,
    /Memory.*非权威.*docs、ADR、code、tests、schema、lint 和 CI.*事实源/s,
    /Host identity.*hook.*环境变量.*外层 Adapter/s,
    /真实 Host.*Prompt、mock 或 catalog.*代替/s,
  ]) {
    assert.match(roadmap, contract);
  }
  assert.match(config, /优化路线图/);
  assert.match(config, /\/project\/optimization-roadmap/);
});
