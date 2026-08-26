import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');

test('memory autopilot maps lifecycle signals to one quiet action', () => {
  assert.match(
    agents,
    /session.*title.*objective.*completed.*next.*reason.*非空.*string.*(?:非|不得).*(?:数组|array).*(?:对象|object)/s,
  );
  assert.match(
    agents,
    /旧 open.*全 resolved.*`"clearOpen":true`.*部分.*`"open":"<剩余项>"`.*省略=保留.*不能更新\/清理.*存疑保留/s,
  );
  assert.match(
    agents,
    /verifier.*本轮运行.*`"verification":"<当前命令\+结果>"`.*省略=保留.*不能更新\/清理/s,
  );
  assert.match(agents, /open 空\/sentinel\/请求\/verifier\/task\/验收完成.*均非结束信号/s);
  assert.match(
    agents,
    /纯 host-signal\/replay turn.*可空响应.*零 commentary\/final.*宿主强制.*最多一句上一已验结果.*replay.*原样 handoff 一次.*禁改 payload\/close\/reopen/s,
  );
  assert.match(agents, /paused.*普通偏好.*本 task\/thread.*照做.*不写画像/s);
  assert.match(
    agents,
    /paused.*普通偏好.*仅回格式\/任务结果.*禁述.*生效范围\/profile\/autopilot\/持久化\/未来适用承诺/s,
  );
  assert.match(
    agents,
    /paused.*普通偏好.*不写画像.*明示画像控制.*纠正=reconcile-profile.*paused 也可.*payload 必加.*userDirected:true.*单次执行.*不 resume/s,
  );
});
