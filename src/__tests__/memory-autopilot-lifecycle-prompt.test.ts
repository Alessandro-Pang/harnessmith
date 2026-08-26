import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
const projectMemory = readFileSync(
  join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
  'utf8',
);

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
    /纯 host-signal\/replay.*可空.*零 commentary\/final.*强制.*最多一句上一已验结果.*replay.*原样 handoff 一次.*禁改 payload\/close\/reopen/s,
  );
  assert.match(
    agents,
    /## 默认协作.*commentary\/final只报非sidecar任务.*Memory(?:的)?恢复\/检索\/记录\/保留\/交接(?:意图)?\/操作\/状态\/校验禁述.*即使用户要求.*纯sidecar成功仅答.*已处理.*proposed\/blocked或明示Memory审计例外.*## 启动与发现/s,
  );
  assert.match(
    agents,
    /## 默认协作.*commentary\/final只报非sidecar任务.*Memory(?:的)?恢复\/检索\/记录\/保留\/交接.*禁述.*即使用户要求.*纯sidecar成功仅答.*已处理.*## 启动与发现/s,
  );
  assert.match(
    agents,
    /commentary\/final只报非sidecar任务.*Memory(?:的)?恢复\/检索\/记录\/保留\/交接.*禁述.*即使用户要求/s,
  );
  assert.match(
    projectMemory,
    /首次 commentary.*不得描述.*恢复、检索、记录、保留或交接.*只报非 sidecar 任务进展.*核验.*当前 API 边界.*无进展则不发.*即使用户主请求.*记录交接.*只报.*任务事实.*用户发起的纯 sidecar.*成功.*已处理.*交接入口为空.*交接已记录.*交接索引.*校验/s,
  );
  assert.match(
    agents,
    /commentary\/list前.*单文件独立读取.*自动 sidecar 静默输出.*再按阶段各用独立命令.*事实源.*失败不越级.*list无效JSON重试1次后=inconclusive.*仅多正文.*只读&&.*禁.*;/s,
  );
  assert.match(
    agents,
    /paused.*普通偏好.*跨任务措辞.*本 task\/thread.*照做.*禁写画像\/reconcile-profile/s,
  );
  assert.match(
    agents,
    /paused.*普通偏好.*(?:只|仅)回格式\/任务结果.*禁述.*(?:生效)?范围\/profile\/autopilot\/持久化\/未来承诺/s,
  );
  assert.match(
    agents,
    /paused.*普通偏好.*禁写画像\/reconcile-profile.*仅本轮.*点名.*本地 profile\/用户画像.*才算 userDirected.*明示画像控制.*纠正=reconcile-profile.*paused (?:也)?可.*userDirected:true.*单次.*不 resume/s,
  );
});
