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
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const autopilotBlock = projectMemory.match(
    /## Memory Autopilot[\s\S]*?```bash\n([\s\S]*?)```/,
  )?.[1];
  const profileBlock = profile.match(/## Agent 维护时机[\s\S]*?```bash\n([\s\S]*?)```/)?.[1];

  assert.match(agents, /验收.*scope\/constraints.*不可廉价恢复.*必须.*capture-input/s);
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
  assert.match(agents, /全局.*core\.md.*命中/s);
  assert.match(agents, /新.*distilled.*proposal/s);
  assert.match(agents, /created\/updated\/unchanged.*静默.*proposed\/blocked.*简短/s);
  assert.match(agents, /用户明确.*纠正.*遗忘.*暂停.*恢复.*简短/s);
  assert.match(
    agents,
    /用户.*(?:明确声明|明确设为).*跨任务默认.*稳定偏好.*角色.*工作方式.*纠正旧画像/s,
  );
  assert.match(agents, /(?:本次或本项目|单次).*信号.*项目 Memory/s);
  assert.match(agents, /completed\/decisions\/open\/verification\/next/);
  assert.match(agents, /(?:只有|仅).*resolved.*superseded.*清理.*模糊.*保留/s);
  assert.match(agents, /宿主压缩(?:或预算)?信号.*Agent 判断(?:上下文)?即将压缩/s);
  assert.match(agents, /同一会话连续完成多项任务\/决策/);
  assert.match(agents, /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json/s);
  assert.match(agents, /close-handoff.*--session.*--json.*不支持.*--payload-file/s);
  assert.match(agents, /payload.*宿主提供.*任务临时目录/s);
  assert.match(agents, /未收到.*明确结束信号.*不得.*close-handoff/s);
  assert.match(agents, /压缩.*信号.*即使.*快照.*(?:仍|须|必须).*checkpoint/s);
  assert.match(agents, /例行.*不(?:在|得).*(?:过程|最终答复).*Memory.*(?:handoff|checkpoint)/s);
  assert.match(
    agents,
    /阶段.*已验证.*仍有后续.*最终答复前.*必须.*handoff.*校验.*不得.*下一.*用户.*消息/s,
  );
  assert.match(agents, /阶段.*已验证.*仍有后续.*reason.*phase/s);
  assert.match(
    agents,
    /第二个.*独立.*验证.*最终答复前.*reason.*multi-task.*后续.*原位更新.*compaction.*multi-task.*phase/s,
  );
  assert.match(agents, /静默.*不得.*预告.*Memory.*(?:写入|动作).*失败后.*报告/s);
  assert.match(agents, /用户指定.*verifier.*单独执行.*&&.*后续(?:命令)?退出码.*不得.*替代/s);
  assert.match(agents, /不以.*删除断言.*篡改 verifier.*降低门槛.*通过/s);
  const agentLines = agents.trimEnd().split('\n');
  assert.ok(agentLines.length <= 55, `template/AGENTS.md has ${agentLines.length} lines`);
  assert.ok(Buffer.byteLength(agents) <= 5_400, 'template/AGENTS.md exceeds 5400 bytes');
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
    /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json.*close-handoff.*--session.*--json.*不支持.*--payload-file/s,
  );
  assert.match(projectMemory, /明确结束信号.*close-handoff/s);
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
  assert.match(projectMemory, /`source`.*`chat`.*`file`.*`meeting`.*`link`.*`other`/s);
  assert.match(projectMemory, /静默.*不得.*预告.*Memory.*(?:写入|动作).*失败后.*报告/s);
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
  assert.match(profile, /自动.*自由文本.*--payload-file.*shell.*插值/s);
  assert.match(profile, /暂停.*更正.*userDirected.*paused/s);
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
  assert.match(readme, /capture-input --payload-file/);
  assert.match(english, /capture-input --payload-file/);
});
