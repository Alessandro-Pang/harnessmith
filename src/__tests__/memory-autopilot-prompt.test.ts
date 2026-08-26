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
  const readOnlyAutopilotLine = agents
    .split('\n')
    .find((line) => line.includes('只读时') && line.includes('Memory Autopilot'));
  assert.ok(readOnlyAutopilotLine);
  assert.match(
    readOnlyAutopilotLine,
    /只读时.*不写.*已有才用.*Memory Autopilot.*缺失不建.*修改\/构建/s,
  );
  assert.match(agents, /每个新宿主.*task\/thread.*首次工作前.*读取一次.*`profile\.md`/s);
  assert.match(
    agents,
    /首个.*动作.*\{\{HARNESS_MEMORY_HOME\}\}\/profile\.md.*(?:不得先|此前禁).*pwd.*Git.*rg.*find.*ls/s,
  );
  assert.match(
    agents,
    /\.agent-docs.*存在.*首次读写前.*严格依次.*独立读.*Memory 静默段.*list 元信息.*core\.md.*task status.*maintain.*命中正文.*单文件.*(?:不得|不)跳过/s,
  );
  assert.match(agents, /\.agent-docs.*缺失依规.*只读任务.*不建/s);
  assert.match(
    agents,
    /绝对项目根.*test -d "<project-root>\/\.agent-docs".*(?:ignore|忽略).*(?:不能|不得).*因.*(?:rg|Git).*不存在/s,
  );
  assert.match(agents, /全局.*core\.md.*命中/s);
  assert.match(agents, /新.*distilled.*proposal/s);
  assert.match(agents, /autopilot enabled.*静默.*reconcile/s);
  assert.match(
    agents,
    /明示画像控制.*(?:直跑|直接执行).*CLI.*--json.*不查.*docs.*skill.*首条(?:消息)?.*结果.*纠正=.*遗忘=.*暂停\/恢复=/s,
  );
  assert.match(agents, /跨任务稳定偏好.*角色.*工作方式.*明示画像控制/s);
  assert.match(agents, /(?:explicit\/high.*静默|静默.*explicit\/high).*reconcile/s);
  assert.match(agents, /(?:本次或本项目|单次).*信号.*项目 Memory/s);
  assert.match(
    agents,
    /autopilot enabled.*才.*静默.*explicit\/high.*reconcile.*跨任务稳定偏好.*角色.*工作方式/s,
  );
  assert.match(
    agents,
    /明示画像控制.*纠正=reconcile-profile.*paused 也可.*payload 必加.*userDirected:true.*单次执行.*不 resume/s,
  );
  assert.doesNotMatch(
    agents,
    /(?:旧画像纠正|明示(?:改|修改)画像|明示画像控制).*autopilot.*(?:未暂停|enabled).*才.*(?:直跑|reconcile)/s,
  );
  assert.match(
    agents,
    /completed.*累计.*next=首个有效 open\/active-task\/plan\/backlog.*点名.*文件\/命令\/动作.*该项已知 verifier 须精确命令写 next.*缺一.*本 turn.*修正 payload 后执行.*旧空泛 next 无效/s,
  );
  assert.match(
    agents,
    /(?:handoff )?payload.*session.*title.*objective.*completed.*next.*reason.*必填/s,
  );
  assert.match(agents, /title.*objective.*未变.*当前 handoff.*原样带入/s);
  assert.match(agents, /未变可选字段.*才省略/s);
  assert.doesNotMatch(agents, /未变(?:字段)?省略/s);
  assert.match(
    agents,
    /压缩\/预算.*signal.*本 turn.*下条消息前.*静默.*执行\/校验.*handoff\(reason=compaction\).*重复快照.*不豁免.*预判压缩.*快照不足恢复.*实质变化/s,
  );
  assert.match(agents, /同一会话.*第2个独立任务.*reason=multi-task/);
  assert.match(
    agents,
    /Memory CLI=`node \{\{HARNESS_HOME\}\}\/agent-harness\/bin\/harness\.mjs memory`.*各子命令单独执行/s,
  );
  assert.match(
    agents,
    /宿主提供的 task temp 绝对路径.*capture-input <root> --payload-file <host-temp-abs> --json.*handoff <root> --payload-file <host-temp-abs> --json/s,
  );
  const payloadCommandLine = agents
    .split('\n')
    .find((line) => line.includes('Memory CLI=') && line.includes('capture-input <root>'));
  assert.ok(payloadCommandLine);
  assert.match(payloadCommandLine, /payload-file 仅用宿主提供的 task temp 绝对路径/);
  assert.match(payloadCommandLine, /--payload-file <host-temp-abs> --json/);
  assert.doesNotMatch(payloadCommandLine, /--scope/);
  const handoffCommandLine = agents
    .split('\n')
    .find((line) => line.trimStart().startsWith('handoff <root>'));
  assert.ok(handoffCommandLine);
  assert.match(handoffCommandLine, /handoff <root> --payload-file <host-temp-abs> --json/);
  assert.match(handoffCommandLine, /reconcile-profile --payload-file <host-temp-abs> --json/);
  assert.match(handoffCommandLine, /close-handoff <root> --session <stable-id> --json/);
  assert.doesNotMatch(handoffCommandLine, /--scope/);
  assert.match(agents, /capture-input=\{title,content,source:chat\|file\|meeting\|link\|other\}/);
  assert.match(agents, /reconcile-profile=\{key,conclusion,evidence:explicit,confidence:high\}/s);
  assert.doesNotMatch(agents, /明示.*改画像.*不(?:应|须|得)?加.*userDirected:true/s);
  assert.match(
    agents,
    /close-handoff\s+<root>\s+--session\s+<stable-id>\s+--json.*无 (?:--payload-file|payload)/s,
  );
  const closeHandoffLine = agents.split('\n').find((line) => line.includes('close-handoff'));
  assert.ok(closeHandoffLine);
  assert.match(closeHandoffLine, /close-handoff <root> --session <stable-id> --json.*无 payload/);
  assert.match(
    agents,
    /root.*位置参数.*capture-input.*无.*--scope.*handoff.*scope.*payload.*不内联.*--scope/s,
  );
  assert.match(agents, /--payload-file <host-temp-abs> --json/s);
  assert.match(
    agents,
    /阶段\/请求\/verifier\/task.*完成\s*(?:≠|不(?:是|等于|构成|算))\s*workstream\s*结束.*close gate.*当前 turn.*用户明示.*整个 workstream.*结束\/取消.*host 标记 completed\/cancelled.*active task\/plan\/backlog\/open\/next.*无有效项.*close-handoff.*否则不关/s,
  );
  assert.match(agents, /压缩.*预算.*signal.*本 (?:signal )?turn.*下条(?:用户)?消息前.*handoff/s);
  assert.match(
    agents,
    /commentary\/final.*首条起.*仅报任务事实.*恢复\/继续\/记住\/保留\/写回.*报告请求.*Memory.*例行.*定位\/读\/核\/写\/归档\/复检\/成功结果.*改写禁述.*proposed\/blocked.*须报.*明示审计\/状态\/清单.*可报.*纯 host-signal\/replay.*可空.*零 commentary\/final.*强制.*最多一句上一已验结果.*replay.*原样 handoff 一次.*禁改 payload\/close\/reopen.*强制消息禁述.*记录\/重放\/保存\/压缩\/衔接\/继续\/持久化/s,
  );
  assert.doesNotMatch(agents, /正常任务消息不受限/);
  assert.match(
    agents,
    /plan\/backlog.*已核验有后续.*阶段验证完成后.*本轮未授权也须.*最终答复前.*写\/校验.*handoff\(reason=phase\).*不等下条(?:用户)?消息/s,
  );
  assert.match(agents, /项目.*scope.*(?:用.*`\.`|=`\.`).*绝对(?:项目)?根/s);
  assert.match(
    agents,
    /项目 Memory.*已有\/应初始化.*新\/变更验收\/scope\/constraints.*不可廉价恢复.*任务改动前.*逐字.*capture-input/s,
  );
  assert.match(agents, /任务改动前.*逐字.*capture-input.*画像\/handoff.*不替代/s);
  assert.match(
    agents,
    /next=首个有效 open\/active-task\/plan\/backlog.*点名.*文件\/命令\/动作.*该项已知 verifier 须精确命令写 next.*旧空泛 next 无效.*无项.*等待用户给出范围/s,
  );
  assert.match(agents, /handoff 前自检.*缺一.*本 turn.*修正 payload 后执行/s);
  assert.doesNotMatch(
    agents,
    /(?:不须|无需|不必).{0,8}(?:点名|写)|允许.{0,12}处理下一请求|空泛旧值.*(?:仍有效|视为有效|允许沿用)|(?:不禁|允许).{0,8}覆盖已知项|reason=(?:phase|compaction) handoff/s,
  );
  assert.match(agents, /压缩\/预算.*signal.*turn.*静默.*reason=compaction.*handoff/s);
  assert.match(agents, /plan\/backlog.*已核验有后续.*阶段验证完成.*workstream.*结束/s);
  assert.match(agents, /高损失.*不可推断/);
  assert.match(agents, /首条仅结果\/阻塞.*格式优先.*纠正=.*遗忘=.*暂停\/恢复=/s);
  assert.match(
    agents,
    /明示画像控制.*(?:直跑|直接执行).*CLI.*--json.*不查.*docs.*skill.*不预告.*首条.*结果\/阻塞.*格式优先.*纠正=.*遗忘=.*暂停\/恢复=/s,
  );
  assert.match(
    agents,
    /遗忘从已读 profile.*唯一匹配.*exact-key.*原样执行.*0\/多匹配.*阻塞.*禁猜.*已替代\/无需删除.*跳过/s,
  );
  assert.match(agents, /敏感.*冲突.*越界.*提示/s);
  assert.match(
    agents,
    /明示画像控制.*(?:直跑|直接执行).*CLI.*不查.*docs.*skill.*help.*纠正=reconcile-profile.*--payload-file\s+<path>\s+--json.*遗忘=forget-profile.*--key.*exact-key.*--json.*暂停\/恢复=profile-autopilot.*pause\|resume.*--json/s,
  );
  assert.match(
    agents,
    /(?:第二|第2)个.*独立.*验证.*最终答复前.*reason.*multi-task.*后续.*原位更新.*compaction.*multi-task.*phase/s,
  );
  assert.match(
    agents,
    /commentary\/final.*首条起.*仅报任务事实.*恢复\/继续\/记住\/保留\/写回.*报告请求.*Memory.*例行.*定位\/读\/核\/写\/归档\/复检\/成功结果.*改写禁述.*proposed\/blocked.*须报.*明示审计\/状态\/清单.*可报.*强制.*最多一句上一已验结果.*强制消息禁述.*sidecar 状态/s,
  );
  assert.match(agents, /用户指定\/关键 verifier.*单跑.*&&.*后续退出码.*不替代/s);
  assert.match(agents, /不以.*删(?:除)?断言.*篡改 verifier.*降(?:低)?门槛.*通过/s);
  const taskRouteLine = agents
    .split('\n')
    .find((line) => line.includes('修改/诊断/评审/设计/发布'));
  assert.ok(taskRouteLine);
  assert.match(taskRouteLine, /先读唯一命中 playbook/);
  assert.match(
    taskRouteLine,
    /项目 Memory.*standards\/project-agent-docs\.md.*自动 sidecar 静默输出.*命中段/,
  );
  assert.match(agents, /交付结果\/证据\/未验证\/风险；只读评估分开写未执行与未来需授权动作/);
  const agentLines = agents.trimEnd().split('\n');
  assert.ok(agentLines.length <= 60, `template/AGENTS.md has ${agentLines.length} lines`);
  assert.ok(Buffer.byteLength(agents) <= 6_600, 'template/AGENTS.md exceeds 6600 bytes');
  const representativeRenderedAgents = agents
    .replaceAll('{{HARNESS_HOME}}', '/Users/example/.config/codex')
    .replaceAll('{{HARNESS_MEMORY_HOME}}', '/Users/example/.local/share/agent-docs')
    .replaceAll('{{HARNESS_PERSONAL_HOME}}', '/Users/example/.config/agent-harness');
  assert.ok(
    Buffer.byteLength(representativeRenderedAgents) <= 6_650,
    'representative rendered AGENTS.md exceeds 6650 bytes',
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
    /`capture-input`.*项目根.*位置参数.*`capture-input <project-root> --payload-file <path> --json`.*不支持 `--scope`.*`handoff`.*位置参数 `<project-root>`.*不能用 `--scope` 代替.*恢复 scope.*payload.*`scope`.*不内联 `--scope`/s,
  );
  assert.match(
    projectMemory,
    /绝对项目根.*test -d "<project-root>\/\.agent-docs".*(?:ignore|忽略).*不得.*(?:rg|Git).*未命中.*不存在.*memory maintain.*候选.*当前目标.*路径.*关键词.*匹配.*unindexed\/expired.*元信息.*命中.*未被 `core\.md` 引用.*不得.*跳过.*unindexed.*补索引.*expired working.*补索引.*保留.*typed checkpoint.*明确授权.*续期.*无独有恢复价值.*归档.*首次 indexed 校验失败.*先静默.*恢复并重验.*不能.*blocked.*生命周期自动授权.*仅限.*普通 episode\/working note.*input\/evidence.*session-handoff.*task-ledger.*排除.*typed lifecycle.*当前事实.*无独有恢复价值.*archive --force.*唯一.*禁止.*删除.*正式文档.*promote.*新建 `distilled`/s,
  );
  assert.match(projectMemory, /陈旧.*不相关.*backlog.*不触发.*phase/s);
  assert.match(
    projectMemory,
    /capture-input.*handoff.*reconcile-profile.*--payload-file.*--json.*close-handoff.*--session.*--json.*不支持.*--payload-file/s,
  );
  assert.match(
    projectMemory,
    /当前 user turn.*整个 workstream.*结束\/取消.*宿主.*当前 host turn.*completed\/cancelled.*close-handoff/s,
  );
  assert.match(
    projectMemory,
    /压缩.*信号.*signal turn.*下一?条用户消息前.*reason.*compaction.*checkpoint.*已有.*相同.*刚更新.*不豁免.*仅预判压缩/s,
  );
  assert.match(
    projectMemory,
    /signal turn.*必须静默执行.*自动 sidecar.*读取.*核对.*写入.*created.*updated.*unchanged.*状态或结果.*必须全程静默.*不得预告.*复述.*强制.*上一.*用户任务.*已验证.*进度或结果.*禁述.*保存.*压缩/s,
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
    /handoff.*执行前.*自检.*所选首个.*有效项.*文件.*`next`.*同一文件.*verifier.*适用于该项.*命令.*缺一.*当前 turn.*修正 payload 后执行.*不能.*跳过.*signal checkpoint/s,
  );
  assert.match(
    projectMemory,
    /当前 user turn.*workstream.*结束\/取消.*宿主.*当前 host turn.*completed\/cancelled.*核验.*active task.*plan\/backlog.*`open`\/`next`.*有效.*不存在.*才.*close-handoff/s,
  );
  assert.match(
    projectMemory,
    /当前或.*最后一个已知阶段.*单个请求.*verifier.*普通 task\/thread.*完成.*不构成 workstream 结束信号/s,
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
    /## 自动 sidecar 静默输出.*只约束用户可见 commentary\/final.*不禁止必要工具执行.*任务动词.*不构成 Memory 操作报告请求.*自动 sidecar.*读取.*核对.*写入.*created.*updated.*unchanged.*状态或结果.*必须全程静默.*不得预告.*复述.*混入正常消息.*最终交付.*宿主强制.*上一.*用户任务.*已验证.*进度或结果.*禁述.*Memory.*交接.*输入记录.*正常任务消息.*照常.*不得提及.*将要.*正在.*已经.*读取.*核对.*写入.*Memory\/交接.*不得.*夹带.*sidecar.*状态.*结果.*其他结果.*规则报告.*保留发现.*清理材料.*索引校验.*检查未索引线索.*调查材料校验通过.*失效.*不可达.*活跃条目.*写回项目记忆.*收敛这些记忆.*已索引结论已保留.*移入可恢复归档.*维护复检结果.*恢复调查.*保留发现.*自动 sidecar.*不等于.*操作.*报告.*用户明确索要 Memory 审计.*状态.*变更清单/s,
  );
  assert.match(
    projectMemory,
    /自动 sidecar.*读取.*核对.*写入.*全程静默.*不得预告.*复述.*宿主强制.*已验证.*禁述.*保存.*压缩.*切换.*收尾.*正常任务消息.*照常.*不得提及.*Memory\/交接.*sidecar/s,
  );
  assert.match(
    projectMemory,
    /正常任务消息.*不得提及.*将要.*正在.*已经.*读取.*核对.*写入.*Memory\/交接.*sidecar.*状态.*结果/s,
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
    /自动 sidecar.*读取.*核对.*写入.*全程静默.*宿主强制.*commentary\/final.*上一.*用户任务.*已验证.*禁述.*保存.*压缩.*切换.*收尾/s,
  );
  assert.match(projectMemory, /宿主强制.*只陈述.*已验证.*不得.*准备继续/s);
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
    /handoff.*执行前.*自检.*所选首个.*有效项.*文件.*`next`.*同一文件.*verifier.*适用于该项.*命令.*缺一.*当前 turn.*修正 payload 后执行.*不得跳过.*signal checkpoint/s,
  );
  assert.match(
    longRunning,
    /signal turn.*必须静默执行.*自动 sidecar.*读取.*核对.*写入.*created.*updated.*unchanged.*状态或结果.*必须全程.*静默.*不得预告.*复述.*宿主强制.*commentary\/final.*上一用户任务.*已验证.*禁述.*保存.*压缩.*切换.*收尾.*正常任务消息.*照常.*不得提及.*Memory\/交接.*sidecar/s,
  );
  assert.match(
    longRunning,
    /正常任务消息.*不得提及.*将要.*正在.*已经.*读取.*核对.*写入.*Memory\/交接.*sidecar.*状态.*结果/s,
  );
  assert.match(
    longRunning,
    /当前 user turn.*workstream.*结束\/取消.*宿主.*当前 host turn.*completed\/cancelled.*核验.*open.*next.*无仍有效事项.*才.*close-handoff.*`next`.*必填恢复动作.*关闭不要求其.*为空.*存疑不关/s,
  );
  assert.match(
    longRunning,
    /当前或最后一个已知阶段.*单个请求.*verifier.*普通 task\/thread.*完成.*不是 workstream 结束/s,
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
  assert.match(profile, /paused.*以后.*未来.*默认.*普通偏好.*不是.*修改画像.*不得.*userDirected/s);
  assert.match(
    profile,
    /自然语言.*明确遗忘.*已读 canonical profile.*唯一匹配.*唯一命中.*原样.*exact key.*forget-profile.*0 个或多个候选.*阻塞.*澄清.*禁止猜 key.*不得.*已替代.*无需删除.*跳过/s,
  );
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
  assert.match(
    operatingModel,
    /当前或最后一个.*已知阶段.*请求.*verifier.*task.*完成.*不算 workstream 结束信号/s,
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
    /关闭.*当前 user turn.*workstream.*结束\/取消.*宿主.*当前 host turn.*completed\/cancelled.*核验.*无有效事项.*`next`.*不要求.*为空.*存疑不关/s,
  );
  assert.match(
    operatingModel,
    /首次或变更.*验收.*任何任务改动前.*逐字.*捕获.*画像\/handoff.*不替代.*`next`.*当前 `open`.*active task.*plan\/backlog.*首个.*仍有效项.*文件.*命令.*动作.*verifier.*旧 `next`.*空泛.*无效.*替换/s,
  );
  assert.match(readme, /capture-input --payload-file/);
  assert.match(english, /capture-input --payload-file/);
});
