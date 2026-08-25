import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('memory autopilot prompts require observable quiet and payload-safe behavior', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const projectMemory = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const longRunning = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'long-running-tasks.md'),
    'utf8',
  );
  const profile = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
    'utf8',
  );
  const architecture = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
    'utf8',
  );
  const operatingModel = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
    'utf8',
  );
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const autopilotBlock = projectMemory.match(
    /## Memory Autopilot[\s\S]*?```bash\n([\s\S]*?)```/,
  )?.[1];
  const profileBlock = profile.match(/## Agent 维护时机[\s\S]*?```bash\n([\s\S]*?)```/)?.[1];

  assert.match(agents, /验收.*scope\/constraints.*不可廉价恢复.*(?:必须|须).*逐字.*capture-input/s);
  assert.match(agents, /项目 Memory.*初始化.*capture-input.*proposal/s);
  assert.match(agents, /逐字.*去重.*capture-input.*否则不写/s);
  assert.match(agents, /每个新宿主.*task\/thread.*首次工作前.*读取一次.*`profile\.md`/s);
  assert.match(
    agents,
    /首个.*动作.*\{\{HARNESS_MEMORY_HOME\}\}\/profile\.md.*不得先.*pwd.*Git.*rg.*find.*ls/s,
  );
  assert.match(
    agents,
    /新宿主.*task\/thread.*\.agent-docs.*首次(?:读写|读取或修改).*静默.*单文件.*不得跳过/s,
  );
  assert.match(
    agents,
    /绝对项目根.*test -d "<project-root>\/\.agent-docs".*(?:ignore|忽略).*不得.*(?:rg|Git).*不存在/s,
  );
  assert.match(agents, /全局.*core\.md.*命中/s);
  assert.match(agents, /新.*distilled.*proposal/s);
  assert.match(agents, /自动 reconcile.*全程静默.*proposed\/blocked.*简报/s);
  assert.match(
    agents,
    /Harness 画像明示纠正.*遗忘.*autopilot.*暂停.*恢复.*直接执行.*CLI.*--json.*不查.*产品文档.*skill.*首条消息.*结果/s,
  );
  assert.match(
    agents,
    /用户明确.*(?:设为|表达为).*跨任务默认.*稳定偏好.*角色.*工作方式.*(?:旧画像纠正|纠正旧画像)/s,
  );
  assert.match(agents, /explicit\/high.*静默 reconcile/s);
  assert.match(agents, /(?:本次或本项目|单次).*信号.*项目 Memory/s);
  assert.match(agents, /completed.*累计.*next=首个.*有效待办.*须点名.*文件.*命令.*动作/s);
  assert.match(
    agents,
    /handoff payload.*每次.*必含.*session.*title.*objective.*completed.*next.*reason/s,
  );
  assert.match(agents, /title.*objective.*未变.*当前 handoff.*原样带入/s);
  assert.match(
    agents,
    /未变.*facts.*decisions.*open.*verification.*scope.*sourceRefs.*省略.*不改/s,
  );
  assert.match(agents, /未变.*facts.*sourceRefs.*省略.*不改.*原样重放除外/s);
  assert.match(agents, /completed.*累计.*next=首个.*有效待办.*须点名.*文件.*命令.*动作/s);
  assert.match(agents, /(?:只有|仅).*resolved.*superseded.*清理.*存疑.*保留/s);
  assert.match(
    agents,
    /宿主压缩\/预算.*signal.*本 signal turn.*下条用户消息前.*(?:须|必须).*静默.*单独执行.*校验.*reason=compaction.*handoff.*已有.*相同.*刚更新.*均不豁免.*仅预判压缩.*快照不足恢复.*实质变化/s,
  );
  assert.match(agents, /同一会话(?:连续)?完成多项任务\/决策/);
  assert.match(agents, /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json/s);
  assert.match(agents, /close-handoff.*--session\s+<stable-id>\s+--json.*不支持.*--payload-file/s);
  assert.match(agents, /payload.*宿主(?:提供的)?任务临时目录/s);
  assert.match(
    agents,
    /本轮完成.*非结束.*仅.*用户明示.*宿主标记.*workstream.*结束\/取消.*无有效后续.*close-handoff.*存疑不关/s,
  );
  assert.match(agents, /压缩.*预算.*signal.*本 signal turn.*下条用户消息前.*(?:须|必须).*handoff/s);
  assert.match(
    agents,
    /例行 sidecar.*成功.*(?:不得|禁).*预告.*复述.*混入正常消息.*宿主强制消息.*上一用户任务.*已验证.*进展\/结果.*禁述.*Memory.*画像.*偏好.*状态.*快照.*交接.*输入记录.*保存.*压缩.*切换.*收尾/s,
  );
  assert.doesNotMatch(agents, /正常任务消息不受限/);
  assert.match(
    agents,
    /例行 sidecar.*(?:不得|禁).*预告.*复述.*混入正常消息.*宿主强制消息.*已验证.*禁述.*保存.*压缩.*切换.*收尾/s,
  );
  assert.match(
    agents,
    /阶段完成并验证.*仍有后续.*(?:须|必须).*最终答复前.*写\/校验.*reason=phase.*handoff.*不等下条用户消息/s,
  );
  assert.match(agents, /阶段.*(?:已验证|并验证).*仍有后续.*reason.*phase/s);
  assert.match(
    agents,
    /(?:计划|plan|backlog).*具体.*后续阶段.*阶段完成并验证.*仍有后续.*本轮.*未授权.*(?:须|必须).*最终答复前.*reason=phase/s,
  );
  assert.match(agents, /项目.*scope.*用.*`\.`.*绝对项目根/s);
  assert.match(
    agents,
    /项目 Memory.*已有\/应初始化.*新\/变更验收\/scope\/constraints.*不可廉价恢复.*任务改动前.*逐字.*capture-input/s,
  );
  assert.match(agents, /任务改动前.*逐字.*capture-input.*画像\/handoff.*不替代/s);
  assert.match(
    agents,
    /next=首个.*有效待办.*须点名.*文件.*命令.*动作.*有 verifier 写.*不能 close.*无项.*等待用户给出范围.*禁覆盖已知项/s,
  );
  assert.doesNotMatch(
    agents,
    /(?:不须|无需|不必).{0,6}点名|允许.{0,12}处理下一请求|(?:不禁|允许).{0,8}覆盖已知项/s,
  );
  assert.match(agents, /宿主压缩\/预算.*signal.*signal turn.*静默.*reason=compaction.*handoff/s);
  assert.match(agents, /workstream.*plan\/backlog.*已核验.*具体后续阶段/s);
  assert.match(agents, /高损失.*不可推断/);
  assert.match(agents, /纠正.*遗忘.*暂停.*恢复.*首条消息.*结果.*单句\/格式优先/s);
  assert.match(
    agents,
    /Harness 画像明示纠正.*遗忘.*暂停.*恢复.*直接执行.*CLI.*--json.*不查.*产品文档.*skill.*禁预告.*首条消息.*仅.*结果.*阻塞.*单句\/格式优先/s,
  );
  assert.match(agents, /paused.*偏好.*(?:执行.*指令|照做).*不报.*持久化/s);
  assert.match(agents, /敏感.*冲突.*越界.*提示/s);
  assert.match(
    agents,
    /Harness 画像明示.*纠正=reconcile-profile.*--payload-file\s+<path>\s+--json.*遗忘=forget-profile.*--key.*profile exact key.*--json.*暂停\/恢复=profile-autopilot.*pause\|resume.*--json.*memory 子命令.*直接执行.*不查.*文档.*skill.*help/s,
  );
  assert.match(
    agents,
    /第二个.*独立.*验证.*最终答复前.*reason.*multi-task.*后续.*原位更新.*compaction.*multi-task.*phase/s,
  );
  assert.match(
    agents,
    /例行 sidecar.*(?:不得|禁).*预告.*复述.*混入正常消息.*宿主强制消息.*已验证.*禁述.*Memory.*画像.*偏好.*状态.*快照.*(?:交接|handoff).*输入记录/s,
  );
  assert.match(agents, /用户指定.*verifier.*单独执行.*&&.*后续(?:命令)?退出码.*不(?:得)?替代/s);
  assert.match(agents, /不以.*删除断言.*篡改 verifier.*降低门槛.*通过/s);
  const agentLines = agents.trimEnd().split('\n');
  assert.ok(agentLines.length <= 55, `template/AGENTS.md has ${agentLines.length} lines`);
  assert.ok(Buffer.byteLength(agents) <= 5_600, 'template/AGENTS.md exceeds 5600 bytes');
  const representativeRenderedAgents = agents
    .replaceAll('{{HARNESS_HOME}}', '/Users/example/.config/codex')
    .replaceAll('{{HARNESS_MEMORY_HOME}}', '/Users/example/.local/share/agent-docs')
    .replaceAll('{{HARNESS_PERSONAL_HOME}}', '/Users/example/.config/agent-harness');
  assert.ok(
    Buffer.byteLength(representativeRenderedAgents) <= 5_800,
    'representative rendered AGENTS.md exceeds 5800 bytes',
  );
  assert.ok(
    Math.max(...agentLines.map((line) => line.length)) <= 240,
    'template/AGENTS.md has a line longer than 240 characters',
  );
  assert.ok(autopilotBlock);
  const captureInputCommand = autopilotBlock.match(/memory capture-input[\s\S]*?(?=\n\n)/)?.[0];
  const handoffCommand = autopilotBlock.match(/memory handoff[\s\S]*?(?=\n\n)/)?.[0];
  const closeHandoffCommand = autopilotBlock.match(/memory close-handoff[\s\S]*$/)?.[0];
  assert.match(captureInputCommand ?? '', /--payload-file[\s\S]*--json/);
  assert.match(handoffCommand ?? '', /--payload-file[\s\S]*--json/);
  assert.match(closeHandoffCommand ?? '', /--session[\s\S]*--json/);
  assert.doesNotMatch(closeHandoffCommand ?? '', /--payload-file/);
  assert.doesNotMatch(
    autopilotBlock,
    /--(?:content|title|objective|completed|facts|decisions|verification|open|next)\b/,
  );
  assert.ok(profileBlock);
  assert.match(profileBlock, /reconcile-profile[\s\S]*--payload-file/);
  assert.doesNotMatch(profileBlock, /--conclusion\b/);
  assert.match(projectMemory, /自动.*自由文本.*--payload-file.*shell.*插值/s);
  assert.match(
    projectMemory,
    /绝对项目根.*test -d "<project-root>\/\.agent-docs".*(?:ignore|忽略).*不得.*(?:rg|Git).*未命中.*不存在/s,
  );
  assert.match(projectMemory, /陈旧.*不相关.*backlog.*不触发.*phase/s);
  assert.match(
    projectMemory,
    /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json.*close-handoff.*--session.*--json.*不支持.*--payload-file/s,
  );
  assert.match(projectMemory, /用户明示.*宿主.*completed\/cancelled.*close-handoff/s);
  assert.match(
    projectMemory,
    /压缩.*信号.*signal turn.*下一?条用户消息前.*reason.*compaction.*checkpoint.*已有.*相同.*刚更新.*不豁免.*仅预判压缩/s,
  );
  assert.match(
    projectMemory,
    /signal turn.*必须静默执行.*created.*updated.*unchanged.*必须全程静默.*不得预告.*复述.*强制.*上一用户任务.*已验证.*进度或结果.*禁述.*保存.*压缩/s,
  );
  assert.match(
    projectMemory,
    /首次出现或变更.*验收.*任何任务改动前.*逐字.*捕获.*画像更新.*handoff.*不能替代/s,
  );
  assert.match(
    projectMemory,
    /阶段.*已验证.*仍有后续.*最终答复前.*必须.*handoff.*校验.*不得.*下一.*用户.*消息/s,
  );
  assert.match(projectMemory, /阶段.*已验证.*仍有后续.*reason.*phase/s);
  assert.match(
    projectMemory,
    /第二个.*独立.*验证.*最终答复前.*reason.*multi-task.*后续.*原位更新.*compaction.*multi-task.*phase/s,
  );
  assert.match(
    projectMemory,
    /`verification`.*string.*`scope`.*string\[\].*`sourceRefs`.*string\[\]/s,
  );
  assert.match(
    projectMemory,
    /handoff payload.*每次.*必填.*string.*`session`.*`title`.*`objective`.*`completed`.*`next`.*`reason`/s,
  );
  assert.match(projectMemory, /`title`.*`objective`.*未变.*当前 handoff.*原样带入/s);
  assert.match(
    projectMemory,
    /未变化.*facts.*decisions.*open.*verification.*scope.*sourceRefs.*省略.*不得.*改写/s,
  );
  assert.match(projectMemory, /生成新.*reconcile payload.*未变化.*显式原样重放除外/s);
  assert.match(projectMemory, /`next`.*首个.*未完成项.*文件.*命令.*动作/s);
  assert.match(
    projectMemory,
    /`next`.*首个.*未完成项.*点名.*文件.*命令.*动作.*已知 verifier.*一并写明.*不能使用.*处理下一请求.*泛化.*确无.*待办.*不能 close.*sentinel.*等待用户给出范围.*不得覆盖.*open.*plan\/backlog.*next/s,
  );
  assert.match(
    projectMemory,
    /用户明示.*workstream.*结束\/取消.*宿主.*workstream.*completed\/cancelled.*核验.*active task.*plan\/backlog.*`open`\/`next`.*有效.*不存在.*才.*close-handoff/s,
  );
  assert.match(projectMemory, /关闭不以.*`next`.*存在.*为空.*必填恢复动作/s);
  assert.match(projectMemory, /不先写.*无下一步.*占位 checkpoint.*普通 task\/thread.*不构成/s);
  assert.match(projectMemory, /`source`.*`chat`.*`file`.*`meeting`.*`link`.*`other`/s);
  assert.match(
    projectMemory,
    /提供来源引用.*必须.*`sourceRefs`.*不能写.*`sourceRef`\/`source-ref`/s,
  );
  assert.match(
    projectMemory,
    /自动 sidecar.*created.*updated.*unchanged.*必须全程静默.*不得预告.*复述.*列入.*最终交付.*宿主强制.*上一用户任务.*已验证.*进度或结果.*禁述.*Memory.*交接.*输入记录.*正常任务消息.*照常.*不得.*夹带.*提及.*sidecar.*动作.*状态.*结果.*其他结果.*规则报告/s,
  );
  assert.match(
    projectMemory,
    /自动 sidecar.*全程静默.*不得预告.*复述.*宿主强制.*已验证.*禁述.*保存.*压缩.*切换.*收尾.*正常任务消息.*照常.*不得.*sidecar/s,
  );
  assert.match(
    projectMemory,
    /同一.*thread.*不相关.*目标.*沿用.*handoff.*明确.*pivot.*resolved.*superseded.*重写.*objective.*清理.*不追加.*历史/s,
  );
  assert.match(
    projectMemory,
    /不相关.*目标.*title.*objective.*next.*替换.*scope.*sourceRefs.*verification.*替换或.*clear.*facts.*decisions.*open.*仍与当前恢复相关.*completed.*紧凑.*累计/s,
  );
  assert.match(projectMemory, /独立进程.*stdout.*JSON result.*单独.*校验索引/s);
  assert.match(
    projectMemory,
    /自动 sidecar.*全程静默.*宿主强制.*commentary\/final.*上一用户任务.*已验证.*禁述.*保存.*压缩.*切换.*收尾/s,
  );
  assert.match(
    longRunning,
    /已有.*active task ledger.*task checkpoint.*没有.*ledger.*不得.*初始化.*reason.*phase.*handoff/s,
  );
  assert.match(
    longRunning,
    /memory handoff.*--payload-file.*--json.*close-handoff.*--session.*--json/s,
  );
  assert.match(longRunning, /生成新 reconcile payload.*未变化.*显式原样重放除外/s);
  assert.match(
    longRunning,
    /handoff payload.*每次.*必填.*session.*title.*objective.*completed.*next.*reason/s,
  );
  assert.match(longRunning, /title.*objective.*未变.*当前 handoff.*原样带入/s);
  assert.match(
    longRunning,
    /压缩.*信号.*signal turn.*下一?条用户消息前.*reason.*compaction.*checkpoint.*已有.*相同.*刚更新.*不豁免.*仅预判压缩/s,
  );
  assert.match(longRunning, /仅预判压缩时.*快照相同.*措辞变化.*不写/s);
  assert.doesNotMatch(longRunning, /(?:^|\n)快照相同或只有措辞变化时不写/m);
  assert.match(
    longRunning,
    /next.*首个.*未完成项.*文件.*命令.*动作.*已知 verifier.*一并写明.*不能写.*处理下一请求.*泛化.*确无.*待办.*不能 close.*sentinel.*等待用户给出范围.*不得覆盖.*open.*plan\/backlog.*next/s,
  );
  assert.match(
    longRunning,
    /signal turn.*必须静默执行.*自动 sidecar.*created.*updated.*unchanged.*必须全程静默.*不得预告.*复述.*宿主强制.*commentary\/final.*上一用户任务.*已验证.*禁述.*保存.*压缩.*切换.*收尾.*正常任务消息.*照常.*不得.*sidecar/s,
  );
  assert.match(
    longRunning,
    /用户明示.*workstream.*结束\/取消.*宿主.*completed\/cancelled.*核验.*open.*next.*有效.*才.*close-handoff.*`next`.*不要求.*为空.*存疑不关/s,
  );
  assert.match(profile, /自动.*自由文本.*--payload-file.*shell.*插值/s);
  assert.match(
    profile,
    /Harness.*画像控制.*不是宿主产品设置.*明示.*纠正.*遗忘.*暂停.*恢复.*直接.*本地命令.*不路由.*产品文档.*skill/s,
  );
  assert.match(
    profile,
    /forget-profile.*--key.*--json.*profile-autopilot pause --json.*resume --json/s,
  );
  assert.match(profile, /暂停.*更正.*userDirected.*paused/s);
  assert.match(
    profile,
    /自动 reconcile.*created\/updated\/unchanged.*不预告\/复述.*画像.*偏好.*proposed\/blocked.*简报/s,
  );
  assert.match(profile, /纠正.*(?:忘记|遗忘).*暂停.*恢复.*单句.*报告.*查看.*完整回答/s);
  assert.match(
    profile,
    /纠正.*忘记.*暂停.*恢复.*不发过程通知.*仅.*最终答复.*简短报告.*默认单句.*当前格式要求.*优先/s,
  );
  assert.match(profile, /paused.*普通偏好.*当前指令.*不报告.*画像.*持久化/s);
  assert.match(profile, /每个新宿主.*task\/thread.*首次工作前.*读取一次.*`profile\.md`/s);
  assert.match(profile, /最多.*32.*有界/s);
  assert.match(architecture, /自动.*自由文本.*--payload-file.*shell.*插值/s);
  assert.match(
    architecture,
    /`facts`.*`decisions`.*`verification`.*`open`.*`scope`.*`source-refs`.*省略.*保留/s,
  );
  assert.match(architecture, /`completed`.*`next`.*每次.*完整/s);
  assert.match(architecture, /`next`.*首个.*未完成项.*文件.*命令.*动作.*verifier/s);
  assert.match(
    architecture,
    /确无有效待办.*缺少结束信号.*不能 close.*sentinel.*等待用户给出范围.*不得覆盖.*open.*plan\/backlog.*next/s,
  );
  assert.match(
    operatingModel,
    /确无有效待办.*缺少结束信号.*不能 close.*sentinel.*等待用户给出范围.*不得覆盖.*open.*plan\/backlog.*next/s,
  );
  assert.match(architecture, /显式 signal.*快照相同.*必须执行.*只有预判压缩.*无实质变化.*不写/s);
  assert.doesNotMatch(architecture, /(?:^|\n)[^。\n]*无变化不写/m);
  assert.doesNotMatch(
    architecture,
    /`completed\/decisions\/open\/verification\/next`\s*省略字段.*表示保留/s,
  );
  assert.match(
    architecture,
    /关闭.*用户明示.*workstream.*结束\/取消.*宿主标记.*completed\/cancelled.*核验.*无有效.*`next`.*必填.*不要求.*为空.*存疑不关/s,
  );
  assert.match(
    operatingModel,
    /关闭.*用户明示.*workstream.*结束\/取消.*宿主标记.*completed\/cancelled.*核验.*无有效.*`next`.*不要求.*为空.*存疑不关/s,
  );
  assert.match(
    operatingModel,
    /首次或变更.*验收.*任何任务改动前.*逐字.*捕获.*画像\/handoff.*不替代.*`next`.*首个.*未完成项.*文件.*命令.*动作.*verifier/s,
  );
  assert.match(readme, /capture-input --payload-file/);
  assert.match(english, /capture-input --payload-file/);
});
