import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { jsonlEvents } from './transcript.mjs';
export function isCodeReviewProfileKey(key, existingKey) {
  const value = String(key ?? '');
  return Boolean(
    value !== String(existingKey ?? '') &&
      value.length <= 100 &&
      /^(?:communication|engineering|review)\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value),
  );
}

function assertedFencedApiBoundaryTargets(content) {
  const lines = String(content ?? '').split(/\r?\n/u);
  const targets = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lead = lines[index].trim();
    if (!/^the verified service boundary is\s*:\s*$/iu.test(lead)) continue;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && !lines[previousIndex].trim()) previousIndex -= 1;
    const previous = previousIndex >= 0 ? lines[previousIndex].trim() : '';
    if (
      /(?:historical|example|draft|proposed|unverified|rejected|deprecated|superseded|历史|示例|草案|提案|未验证|已拒绝|已废弃|被替代)/iu.test(
        previous,
      )
    ) {
      continue;
    }
    let fenceIndex = index + 1;
    while (fenceIndex < lines.length && !lines[fenceIndex].trim()) fenceIndex += 1;
    const opener = lines[fenceIndex]?.trim() ?? '';
    const openerMatch = /^(?<marker>```|~~~)(?:text)?$/iu.exec(opener);
    if (!openerMatch?.groups?.marker) continue;
    const marker = openerMatch.groups.marker;
    let closeIndex = fenceIndex + 1;
    while (closeIndex < lines.length && lines[closeIndex].trim() !== marker) closeIndex += 1;
    if (closeIndex >= lines.length) continue;
    const body = lines
      .slice(fenceIndex + 1, closeIndex)
      .map((line) => line.trim())
      .filter(Boolean);
    if (body.length !== 1) continue;
    const match = /^API\s*(?:->|→)\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/u.exec(body[0]);
    if (match) targets.push(match[1].toLowerCase());
  }
  return targets;
}

export function containsApiWorkerBoundary(content) {
  const visibleLines = [];
  let fenced = false;
  let commented = false;
  for (const rawLine of String(content ?? '').split(/\r?\n/u)) {
    let line = rawLine;
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (commented) {
      if (line.includes('-->')) commented = false;
      continue;
    }
    const commentStart = line.indexOf('<!--');
    if (commentStart >= 0) {
      if (line.indexOf('-->', commentStart + 4) < 0) commented = true;
      line = line.slice(0, commentStart);
    }
    if (!line.trim() || /^\s*>/u.test(line) || /^(?: {4}|\t)/u.test(line)) continue;
    visibleLines.push(line);
  }
  const visible = visibleLines.join('\n');
  if (
    /^\s*(?:status|state)\s*[:=]\s*(?:rejected|deprecated|historical|superseded|proposed|draft|unverified|invalid)\s*$/imu.test(
      visible,
    ) ||
    /(?:\b(?:this|that|the)\s+(?:statement|boundary|claim)\b|\bAPI\s*(?:->|→)\s*Worker\b)[^\r\n.!?。！？]{0,64}\b(?:is\s+)?(?:no\s+longer\s+(?:true|current|correct|valid)|not\s+(?:true|current|correct|valid)|false|incorrect|unverified|obsolete|rejected|deprecated|superseded)\b/iu.test(
      visible,
    ) ||
    /(?:(?:上述|该|这个)?(?:陈述|边界|结论)|API\s*(?:->|→)\s*Worker)[^\r\n。！？]{0,32}(?:不再(?:成立|正确|有效|当前)|错误|不正确|未验证|已拒绝|已废弃|已弃用|被替代)/u.test(
      visible,
    )
  ) {
    return false;
  }
  const clauses = visibleLines.flatMap((line) => {
    let normalized = line
      .trim()
      .replace(/^(?:(?:#{1,6}|[-+])\s+|\d+[.)]\s+)/u, '')
      .trim();
    for (const [open, close] of [
      ['**', '**'],
      ['__', '__'],
      ['*', '*'],
      ['_', '_'],
    ]) {
      if (normalized.startsWith(open) && normalized.endsWith(close)) {
        normalized = normalized.slice(open.length, -close.length).trim();
        break;
      }
    }
    normalized = normalized
      .replace(/`(API\s*(?:->|→)\s*[A-Za-z][A-Za-z0-9_-]*)`/giu, '$1')
      .replace(/\*\*(API\s*(?:->|→)\s*[A-Za-z][A-Za-z0-9_-]*)\*\*/giu, '$1')
      .replace(/__(API\s*(?:->|→)\s*[A-Za-z][A-Za-z0-9_-]*)__/giu, '$1')
      .replace(
        /\s*[,，]\s*(?:(?:and\s+)?`?LegacyWorker`?\s+(?:is\s+)?(?:no longer used|retired|disabled)|(?:(?:且|并声明)\s*)?`?LegacyWorker`?\s*(?:已(?:停用|不再(?:使用|采用))|不再(?:使用|采用)))(?:\s*[:：]\s*\[[^\]\r\n]+\]\([^\)\r\n]+\))?\s*[.!?。！？]?\s*$/iu,
        '',
      );
    return normalized
      .split(/[.!?。！？;；]+/u)
      .map((clause) => clause.trim())
      .filter(Boolean);
  });
  const assertion =
        /^(?:(?:verified(?:\s+stable)?\s+(?:fact|statement)|已验证(?:稳定)?事实)\s*[:：]\s*)?(?:(?:the\s+)?(?:(?:verified|current)\s+)*(?:service\s+)?boundary\s*(?:is|:)\s*(?:(?:now|currently)\s+)?API\s*(?:->|→)\s*([A-Za-z][A-Za-z0-9_-]*)|(?:(?:已验证|当前|目前)\s*)*(?:服务|架构)?边界\s*(?:(?:已)?(?:核实|验证|确认)\s*)?(?:是|为|：)\s*(?:(?:现在|目前)\s*)?API\s*(?:->|→)\s*([A-Za-z][A-Za-z0-9_-]*)|(?:(?:当前|目前)(?:架构|正式)?说明(?:中)?|(?:架构|正式)?说明(?:中)?仍明确|(?:当前|目前)?架构确认|(?:当前|目前)架构|(?:当前|目前)(?:架构|正式)?文档(?:中)?(?:明确)?确认边界)\s*(?:仍)?(?:明确)?(?:是|确?为|：)\s*API\s*(?:->|→)\s*([A-Za-z][A-Za-z0-9_-]*))\s*$/iu;
  const targets = clauses.flatMap((clause) => {
    const match = assertion.exec(clause);
    return match ? [String(match[1] ?? match[2] ?? match[3]).toLowerCase()] : [];
  });
  targets.push(...assertedFencedApiBoundaryTargets(content));
  return targets.length > 0 && targets.every((target) => target === 'worker');
}

export function mentionsRetryInvestigationContext(content) {
  return /(?:\bretry\b[\s\S]{0,80}\b(?:investigat(?:e|es|ed|ing|ion)|debug(?:ged|ging)?|analysis|analy[sz](?:e|es|ed|ing)|context)\b|\b(?:investigat(?:e|es|ed|ing|ion)|debug(?:ged|ging)?|analysis|analy[sz](?:e|es|ed|ing)|context)\b[\s\S]{0,80}\bretry\b|重试[\s\S]{0,40}(?:调查|排查|分析|上下文)|(?:调查|排查|分析|上下文)[\s\S]{0,40}重试)/iu.test(
    String(content ?? ''),
  );
}

export function containsRetryInvestigationContext(content) {
  const clauses = String(content ?? '').split(/[\r\n.!?。！？;；]+/u);
  const unresolved =
    /(?:\b(?:not|never)\s+(?:completed|resolved|cancelled|canceled)\b|\b(?:has|have|had)\s+not\s+(?:yet\s+)?been\s+(?:completed|resolved|cancelled|canceled)\b|\b(?:cannot|can't|could\s+not|couldn't)\s+be\s+(?:completed|resolved|cancelled|canceled)\b|\b(?:is|are|was|were|has|have)\s+yet\s+to\s+be\s+(?:completed|resolved|cancelled|canceled)\b|\b(?:pending|unresolved|open)\b|尚未|未(?:完成|解决|取消)|仍(?:待|需|在)|待(?:调查|排查|分析|处理))/iu;
  const resolved =
    /(?:\bno\b[\s\S]{0,48}\b(?:needed|required|necessary)\b|\b(?:is|was|has\s+been|was\s+successfully)?\s*(?:resolved|completed|cancelled|canceled|unnecessary)\b|\b(?:is|was)?\s*not\s+(?:needed|required|necessary)\b|无需|不再需要|已解决|已完成|已取消)/iu;
  return clauses.some(
    (clause) =>
      mentionsRetryInvestigationContext(clause) &&
      (unresolved.test(clause) || !resolved.test(clause)),
  );
}

export function isRoutineMemoryMaintenanceDisclosure(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;
  const memoryModuleSourceContext =
    /(?:项目)?记忆\s*(?:管理)?模块|Memory\s*(?:管理)?模块|\b(?:memory|sidecar)\s+(?:module|subsystem)\b/iu.test(
      text,
    );
  const explicitProjectMemoryAnchor =
    /项目记忆|记忆中的|\bproject\s+memory\b|\bsidecar\b|\bhandoff\b|\bcheckpoint\b/iu.test(
      text,
    );
  const memoryTerm = String.raw`(?:\b(?:memory|sidecar|handoff|checkpoint)\b|记忆|交接|沉淀)`;
  const maintenanceAction = String.raw`(?:\b(?:read(?:ing)?|inspect(?:ed|ing)?|load(?:ed|ing)?|reconcil(?:e|ed|ing)|writ(?:e|ten|ing)|updat(?:e|ed|ing)|sav(?:e|ed|ing)|archiv(?:e|ed|ing)|index(?:ed|ing)?|maintain(?:ed|ing)?)\b|读取|查看|定位|核对|检查|更新|写回|写入|保存|记录|归档|清理|维护|索引)`;
  const explicitOperation =
    (!memoryModuleSourceContext || explicitProjectMemoryAnchor) &&
    (new RegExp(`${memoryTerm}[\\s\\S]{0,64}${maintenanceAction}`, 'iu').test(text) ||
      new RegExp(`${maintenanceAction}[\\s\\S]{0,64}${memoryTerm}`, 'iu').test(text));
  const sidecarState = String.raw`(?:项目记忆(?:中|内|里)?(?:的)?|记忆(?:中|内|里)(?:的)?|\bmemory\s+(?:records?|entries|notes?|state)\b)`;
  const narrowMaintenanceProgress =
    new RegExp(
      String.raw`(?:再|随后|接着|然后|准备|将|会)?(?:整理|整合|修复|梳理|处理|解决)[\s\S]{0,24}${sidecarState}[\s\S]{0,24}(?:冲突|矛盾|过期|陈旧|stale|contradict)`,
      'iu',
    ).test(
      text,
    ) ||
    new RegExp(
      String.raw`${sidecarState}[\s\S]{0,24}(?:冲突|矛盾|过期|陈旧|stale|contradict)[\s\S]{0,24}(?:整理|整合|修复|梳理|处理|解决)`,
      'iu',
    ).test(
      text,
    );
  const explicitProjectMemoryProgress =
    /(?:整理|整合|梳理|处理|解决|\b(?:organiz(?:e|ed|ing)|curat(?:e|ed|ing)|tidy(?:ing)?|clean(?:ing)?\s+up)\b)[\s\S]{0,24}(?:项目记忆(?!\s*(?:管理)?模块)|\bproject\s+memory\b(?!\s+(?:module|subsystem)))/iu.test(
      text,
    ) ||
    /(?:项目记忆(?!\s*(?:管理)?模块)|\bproject\s+memory\b(?!\s+(?:module|subsystem)))[\s\S]{0,24}(?:整理|整合|梳理|处理|解决|\b(?:organiz(?:e|ed|ing)|curat(?:e|ed|ing)|tidy(?:ing)?|clean(?:ing)?\s+up)\b)/iu.test(
      text,
    );
  const disguisedOutcome =
    /(?:已|已经|完成)?(?:保留|保存|记录)[\s\S]{0,32}(?:高成本|昂贵|关键)?(?:发现|结论)[\s\S]{0,96}(?:清理|归档)[\s\S]{0,48}(?:材料|记录)/iu.test(
      text,
    ) ||
    /(?:有效|活跃|过期|陈旧|stale)[\s\S]{0,32}(?:记录|材料)[\s\S]{0,32}(?:重新)?索引[\s\S]{0,32}(?:检查|校验|通过|完成|成功)/iu.test(
      text,
    ) ||
    /(?:重新)?索引[\s\S]{0,24}(?:完整性|完整)?(?:检查|校验)[\s\S]{0,16}(?:通过|完成|成功)/iu.test(
      text,
    ) ||
    /(?:已|已经|现已|完成)?(?:保留|保存|记录)(?:了|下)?(?:这|该|这些|本)?(?:项|条|个)?[\s\S]{0,16}(?:高成本|昂贵|关键|重要|可复用|长期|难以重新获取)?(?:发现|结论|经验|认知|线索|证据)/iu.test(
      text,
    ) ||
    /(?:这|该|这些|本)?(?:项|条|个)?(?:高成本|昂贵|关键|重要|可复用|长期|难以重新获取)?(?:发现|结论|经验|认知|线索|证据)[\s\S]{0,16}(?:已|已经|现已)?(?:被)?(?:保留|保存|记录)/iu.test(
      text,
    ) ||
    /(?:已|已经|现已|完成)?(?:清理|归档|移除|删除)(?:了)?[\s\S]{0,24}(?:矛盾|过期|陈旧|无效|废弃)[\s\S]{0,16}(?:调查)?(?:材料|记录|笔记|文档|条目)/iu.test(
      text,
    ) ||
    /(?:矛盾|过期|陈旧|无效|废弃)[\s\S]{0,24}(?:调查)?(?:材料|记录|笔记|文档|条目)[\s\S]{0,16}(?:已|已经|现已)?(?:被)?(?:清理|归档|移除|删除)/iu.test(
      text,
    ) ||
    /(?:已|已经|现已)?(?:完成(?:了)?[\s\S]{0,8}(?:经验|知识|记忆)?沉淀|(?:经验|知识|记忆)?沉淀(?:已|已经)?(?:完成|完毕))/iu.test(
      text,
    ) ||
    /(?:新|关键|高成本)?结论[\s\S]{0,20}(?:已|已经|现已)?(?:被)?纳入[\s\S]{0,16}(?:后续)?上下文/iu.test(
      text,
    ) ||
    /(?:旧|过期|陈旧)(?:调查)?(?:项|记录|笔记)[\s\S]{0,20}(?:已|已经|现已)?(?:被)?从[\s\S]{0,12}活跃视图[\s\S]{0,12}移出/iu.test(
      text,
    ) ||
    /(?:检查|查找|定位)[\s\S]{0,24}(?:未被索引|未索引)[\s\S]{0,24}(?:调查)?(?:线索|材料|记录|条目)/iu.test(
      text,
    ) ||
    /(?:调查|恢复)材料[\s\S]{0,16}(?:校验|检查)(?:通过|完成)[\s\S]{0,32}(?:失效|不可达)[\s\S]{0,24}活跃(?:条目|记录)/iu.test(
      text,
    ) ||
    /\b(?:preserv(?:e|es|ed|ing)|sav(?:e|es|ed|ing)|record(?:s|ed|ing)?)\b[\s\S]{0,32}\b(?:high-cost|costly|expensive|valuable|key|important|reusable|long-term|hard-to-recover)?[\s\S]{0,12}\b(?:finding|conclusion|insight|lesson|knowledge|evidence)\b/iu.test(
      text,
    ) ||
    /\b(?:the\s+)?(?:(?:high-cost|costly|expensive|valuable|key|important|reusable|long-term|hard-to-recover)\s+)?(?:finding|conclusion|insight|lesson|knowledge|evidence)\b[\s\S]{0,24}\b(?:(?:has|have|had|is|are|was|were)\s+)?(?:been\s+)?(?:preserved|saved|recorded)\b/iu.test(
      text,
    ) ||
    /\b(?:archiv(?:e|es|ed|ing)|clean(?:s|ed|ing)?\s+up|prun(?:e|es|ed|ing)|remov(?:e|es|ed|ing))\b[\s\S]{0,32}\b(?:stale|outdated|contradictory|obsolete|expired)\b[\s\S]{0,24}\b(?:materials?|records?|notes?|entries|documents?)\b/iu.test(
      text,
    ) ||
    /\b(?:stale|outdated|contradictory|obsolete|expired)\b[\s\S]{0,24}\b(?:materials?|records?|notes?|entries|documents?)\b[\s\S]{0,24}\b(?:(?:has|have|had|is|are|was|were)\s+)?(?:been\s+)?(?:archived|cleaned\s+up|pruned|removed)\b/iu.test(
      text,
    ) ||
    /(?:\b(?:complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?)\b[\s\S]{0,20}\b(?:memory|knowledge|experience)?\s*distillation\b|\b(?:memory|knowledge|experience)?\s*distillation\b[\s\S]{0,16}\b(?:complete|completed|done|finished)\b)/iu.test(
      text,
    );
  return explicitOperation || narrowMaintenanceProgress || explicitProjectMemoryProgress || disguisedOutcome;
}

export function isExplicitProfileControlRoutingViolation({ turnLabel, item }) {
  if (
    !['pause-profile', 'forget-profile', 'explicit-profile-update-while-paused'].includes(
      turnLabel,
    ) ||
    !item
  ) {
    return false;
  }
  if (['web_search', 'network_request'].includes(item.type)) return true;
  if (item.type !== 'command_execution') return false;
  return /(?:^|\/)skills(?:\/[^\/\s'";]+)*\/SKILL\.md\b|openai-docs/i.test(
    String(item.command ?? ''),
  );
}

export function remoteToolViolatesWriteBoundary(type) {
  return ['mcp_tool_call', 'network_request'].includes(type);
}

export function isUnauditableMemoryPayloadCommand(command) {
  return Boolean(
    !exactCommandTokens(command) &&
      /(?:^|\/)harness\.mjs\b[^\n]*\bmemory\b[^\n]*--payload-file\b/i.test(
        String(command ?? ''),
      ),
  );
}

function pathWithin(path, root) {
  const candidate = resolve(path);
  const boundary = resolve(root);
  const relation = relative(boundary, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

export function canonicalPathWithin(path, root) {
  try {
    return pathWithin(realpathSync.native(resolve(path)), realpathSync.native(resolve(root)));
  } catch {
    return pathWithin(path, root);
  }
}

export function inspectJsonPayloadPath(path, root) {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (!resolvedPath.endsWith('.json')) {
    return { ok: false, resolvedPath, error: 'payload path must end in .json' };
  }
  if (!canonicalPathWithin(resolvedPath, resolvedRoot)) {
    return { ok: false, resolvedPath, error: 'payload path is outside the task temp root' };
  }
  try {
    const rootEntry = lstatSync(resolvedRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      return { ok: false, resolvedPath, error: 'task temp root is not a regular directory' };
    }
    const realRoot = realpathSync.native(resolvedRoot);
    const realPath = realpathSync.native(resolvedPath);
    if (!pathWithin(resolvedPath, resolvedRoot) && resolvedPath !== realPath) {
      return { ok: false, resolvedPath, error: 'payload path contains a symlink component' };
    }
    const relativePath = relative(realRoot, realPath);
    let current = realRoot;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      if (lstatSync(current).isSymbolicLink()) {
        return { ok: false, resolvedPath, error: 'payload path contains a symlink component' };
      }
    }
    const entry = lstatSync(resolvedPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      return { ok: false, resolvedPath, error: 'payload is not a regular non-symlink file' };
    }
    if (!pathWithin(realPath, realRoot)) {
      return { ok: false, resolvedPath, error: 'payload real path escapes the task temp root' };
    }
    return { ok: true, resolvedPath, realPath };
  } catch (error) {
    return { ok: false, resolvedPath, error: String(error) };
  }
}

export function inspectProjectScopePath(path, root) {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (!pathWithin(resolvedPath, resolvedRoot)) {
    return { ok: false, exists: false, resolvedPath, error: 'scope path escapes the project root' };
  }
  try {
    const rootEntry = lstatSync(resolvedRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      return {
        ok: false,
        exists: false,
        resolvedPath,
        error: 'project root is not a regular directory',
      };
    }
    const relativePath = relative(resolvedRoot, resolvedPath);
    let current = resolvedRoot;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      let entry;
      try {
        entry = lstatSync(current);
      } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, exists: false, resolvedPath };
        throw error;
      }
      if (entry.isSymbolicLink()) {
        return {
          ok: false,
          exists: true,
          resolvedPath,
          error: 'scope path contains a symlink component',
        };
      }
    }
    const realRoot = realpathSync(resolvedRoot);
    const realPath = realpathSync(resolvedPath);
    if (!pathWithin(realPath, realRoot)) {
      return {
        ok: false,
        exists: true,
        resolvedPath,
        error: 'scope real path escapes the project root',
      };
    }
    return { ok: true, exists: true, resolvedPath, realPath };
  } catch (error) {
    return { ok: false, exists: false, resolvedPath, error: String(error) };
  }
}

export function memoryPayloadAttemptViolatesBoundary({
  exact,
  completed,
  payloadPathOk,
  scopePathOk,
}) {
  return payloadPathOk !== true || scopePathOk !== true || (completed === true && exact !== true);
}

function pathAllowed(path, allowedPaths) {
  return allowedPaths.some((allowed) => {
    if (!allowed.endsWith('/**')) return path === allowed;
    const root = allowed.slice(0, -3);
    return path === root || path.startsWith(`${root}/`);
  });
}

export function memoryAutopilotBoundaryIsSafe({
  projectPaths = [],
  allowedProjectPaths = [],
  globalMemoryPaths = [],
  allowedGlobalMemoryPaths = [],
  personalPaths = [],
  targetPaths = [],
  outsidePaths = [],
  evaluatorPaths = [],
  boundaryViolations = [],
  treeErrors = [],
  beforeHead,
  afterHead,
}) {
  return Boolean(
    projectPaths.every((path) => pathAllowed(path, allowedProjectPaths)) &&
      globalMemoryPaths.every((path) => pathAllowed(path, allowedGlobalMemoryPaths)) &&
      personalPaths.length === 0 &&
      targetPaths.length === 0 &&
      outsidePaths.length === 0 &&
      evaluatorPaths.length === 0 &&
      boundaryViolations.length === 0 &&
      treeErrors.length === 0 &&
      beforeHead &&
      beforeHead === afterHead,
  );
}

export function extractHandoffInvocations(stdout) {
  return jsonlEvents(stdout).flatMap((event) => {
    const item = event?.item;
    if (event?.type !== 'item.completed' || item?.type !== 'command_execution') return [];
    const command = String(item.command ?? '');
    const tokens = exactCommandTokens(command);
    if (!tokens) return [];
    if (
      tokens.length !== 8 ||
      basename(tokens[0]) !== 'node' ||
      !/(?:^|\/)harness\.mjs$/i.test(tokens[1]) ||
      tokens[2] !== 'memory' ||
      tokens[3] !== 'handoff' ||
      tokens[5] !== '--payload-file' ||
      tokens[7] !== '--json' ||
      tokens.filter((token) => token === '--payload-file').length !== 1 ||
      tokens.filter((token) => token === '--json').length !== 1 ||
      tokens[6].startsWith('-')
    ) {
      return [];
    }
    const payloadPath = tokens[6];
    if (!payloadPath || payloadPath.startsWith('$')) return [];
    const output = String(item.aggregated_output ?? '');
    const parsed = parseSingleJsonObject(output);
    return [
      {
        command,
        payloadPath,
        exitCode: item.exit_code,
        completed: item.status === 'completed' && item.exit_code === 0,
        action: typeof parsed?.action === 'string' ? parsed.action : null,
        parsedOutput: parsed,
        output,
      },
    ];
  });
}
