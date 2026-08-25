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

  assert.match(agents, /验收.*scope\/constraints.*不可廉价恢复.*(?:必须|须).*capture-input/s);
  assert.match(agents, /项目 Memory.*初始化.*capture-input.*否则.*proposal/s);
  assert.match(agents, /去重.*无新信息不写/s);
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
  assert.match(agents, /created\/updated\/unchanged.*静默.*proposed\/blocked.*简报/s);
  assert.match(
    agents,
    /Harness 画像明示纠正.*遗忘.*autopilot.*暂停.*恢复.*直接执行.*CLI.*--json.*不查.*产品文档.*skill.*首条消息.*结果/s,
  );
  assert.match(
    agents,
    /用户.*(?:明确声明|明确设为).*跨任务默认.*稳定偏好.*角色.*工作方式.*纠正旧画像/s,
  );
  assert.match(agents, /(?:本次或本项目|单次).*信号.*项目 Memory/s);
  assert.match(agents, /完整累计.*completed.*具体.*next/);
  assert.match(
    agents,
    /未变.*facts.*decisions.*open.*verification.*scope.*sourceRefs.*省略.*不.*改写/s,
  );
  assert.match(agents, /新 payload.*未变.*显式原样重放除外/s);
  assert.match(agents, /完整.*completed.*具体.*next.*文件.*命令.*动作/s);
  assert.match(agents, /(?:只有|仅).*resolved.*superseded.*清理.*模糊.*保留/s);
  assert.match(agents, /宿主压缩(?:或预算|\/预算)?信号.*新快照.*reason=compaction.*预判压缩/s);
  assert.match(agents, /同一会话连续完成多项任务\/决策/);
  assert.match(agents, /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json/s);
  assert.match(agents, /close-handoff.*--session.*--json.*不支持.*--payload-file/s);
  assert.match(agents, /payload.*宿主(?:提供的)?任务临时目录/s);
  assert.match(
    agents,
    /本轮完成.*并非.*结束.*仅.*用户明示.*或宿主标记.*workstream.*结束\/取消.*无有效后续.*close-handoff.*存疑不关/s,
  );
  assert.match(agents, /压缩.*信号.*快照.*(?:仍|须|必须).*checkpoint/s);
  assert.match(
    agents,
    /自动 sidecar.*例行成功.*不对用户预告.*Memory.*状态.*快照.*交接.*输入记录.*正常.*进度.*不受限.*其他.*下文.*报告/s,
  );
  assert.match(agents, /自动 sidecar.*不对用户.*上下文切换.*收尾.*表述.*正常.*进度.*不受限/s);
  assert.match(
    agents,
    /阶段.*(?:已验证|并验证).*仍有后续.*最终答复前.*必须.*handoff.*校验.*不得.*下.*条.*用户.*消息/s,
  );
  assert.match(agents, /阶段.*(?:已验证|并验证).*仍有后续.*reason.*phase/s);
  assert.match(
    agents,
    /(?:计划|plan|backlog).*具体.*后续阶段.*(?:已验证|并验证).*仍有后续.*本轮.*未授权.*最终答复前.*reason.*phase/s,
  );
  assert.match(agents, /项目.*scope.*用.*`\.`.*绝对项目根/s);
  assert.match(
    agents,
    /新增.*验收.*scope\/constraints.*去重后.*(?:下次|下一次)(?:改|修改).*任务文件前.*capture-input/s,
  );
  assert.match(agents, /workstream.*plan\/backlog.*已核验.*具体后续阶段/s);
  assert.match(agents, /高损失.*不可推断/);
  assert.match(agents, /纠正.*遗忘.*暂停.*恢复.*首条消息.*结果.*单句\/格式优先.*查看详答/s);
  assert.match(
    agents,
    /Harness 画像明示纠正.*遗忘.*暂停.*恢复.*直接执行.*CLI.*--json.*不查.*产品文档.*skill.*首条消息.*仅.*结果.*阻塞.*禁预告.*单句\/格式优先/s,
  );
  assert.match(agents, /paused.*普通偏好.*(?:执行.*指令|照做).*不报.*画像.*持久化/s);
  assert.match(
    agents,
    /第二个.*独立.*验证.*最终答复前.*reason.*multi-task.*后续.*原位更新.*compaction.*multi-task.*phase/s,
  );
  assert.match(
    agents,
    /自动 sidecar.*不对用户预告.*Memory.*状态.*快照.*(?:交接|handoff).*输入记录/s,
  );
  assert.match(agents, /用户指定.*verifier.*单独执行.*&&.*后续(?:命令)?退出码.*不得.*替代/s);
  assert.match(agents, /不以.*删除断言.*篡改 verifier.*降低门槛.*通过/s);
  const agentLines = agents.trimEnd().split('\n');
  assert.ok(agentLines.length <= 55, `template/AGENTS.md has ${agentLines.length} lines`);
  assert.ok(Buffer.byteLength(agents) <= 5_400, 'template/AGENTS.md exceeds 5400 bytes');
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
  assert.match(projectMemory, /压缩.*信号.*即使.*快照.*仍.*checkpoint/s);
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
    /`completed`.*string.*`verification`.*string.*`scope`.*string\[\].*`sourceRefs`.*string\[\]/s,
  );
  assert.match(
    projectMemory,
    /未变化.*facts.*decisions.*open.*verification.*scope.*sourceRefs.*省略.*不得.*改写/s,
  );
  assert.match(projectMemory, /生成新.*reconcile payload.*未变化.*显式原样重放除外/s);
  assert.match(projectMemory, /`next`.*具体.*文件.*命令.*动作/s);
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
    /自动 sidecar.*例行成功.*不发.*过程.*不列.*最终.*不预告.*Memory.*交接.*输入记录.*正常任务进度.*不受限.*非例行成功.*结果规则.*报告/s,
  );
  assert.match(
    projectMemory,
    /自动 sidecar.*全程静默.*上下文切换.*准备.*收尾.*同义.*正常任务进度.*不受限/s,
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
  assert.match(readme, /capture-input --payload-file/);
  assert.match(english, /capture-input --payload-file/);
});
