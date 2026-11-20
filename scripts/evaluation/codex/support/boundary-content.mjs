import { exactCommandTokens } from './commands.mjs';

/** @param {unknown} key @param {unknown} existingKey */
export function isCodeReviewProfileKey(key, existingKey) {
  const value = String(key ?? '');
  return Boolean(
    value !== String(existingKey ?? '') &&
      value.length <= 100 &&
      /^(?:communication|engineering|review)\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value),
  );
}

/** @param {unknown} content */
function assertedFencedApiBoundaryTargets(content) {
  const lines = String(content ?? '').split(/\r?\n/u);
  /** @type {string[]} */
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

/** @param {unknown} content */
export function containsApiWorkerBoundary(content) {
  /** @type {string[]} */
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
        /\s*[,，]\s*(?:(?:and\s+)?`?LegacyWorker`?\s+(?:is\s+)?(?:no longer used|retired|disabled)|(?:(?:且|并声明)\s*)?`?LegacyWorker`?\s*(?:已(?:停用|不再(?:使用|采用))|不再(?:使用|采用)))(?:\s*[:：]\s*\[[^\]\r\n]+\]\([^)\r\n]+\))?\s*[.!?。！？]?\s*$/iu,
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

/** @param {unknown} content */
export function mentionsRetryInvestigationContext(content) {
  return /(?:\bretry\b[\s\S]{0,80}\b(?:investigat(?:e|es|ed|ing|ion)|debug(?:ged|ging)?|analysis|analy[sz](?:e|es|ed|ing)|context)\b|\b(?:investigat(?:e|es|ed|ing|ion)|debug(?:ged|ging)?|analysis|analy[sz](?:e|es|ed|ing)|context)\b[\s\S]{0,80}\bretry\b|重试[\s\S]{0,40}(?:调查|排查|分析|上下文)|(?:调查|排查|分析|上下文)[\s\S]{0,40}重试)/iu.test(
    String(content ?? ''),
  );
}

/** @param {unknown} content */
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

/** @param {{ turnLabel: string, item?: import('./types.mjs').CodexItem }} input */
export function isExplicitProfileControlRoutingViolation({ turnLabel, item }) {
  if (
    !['pause-profile', 'forget-profile', 'explicit-profile-update-while-paused'].includes(
      turnLabel,
    ) ||
    !item
  ) {
    return false;
  }
  if (typeof item.type === 'string' && ['web_search', 'network_request'].includes(item.type)) {
    return true;
  }
  if (item.type !== 'command_execution') return false;
  return /(?:^|\/)skills(?:\/[^/\s'";]+)*\/SKILL\.md\b|openai-docs/i.test(
    String(item.command ?? ''),
  );
}

/** @param {unknown} type */
export function remoteToolViolatesWriteBoundary(type) {
  return typeof type === 'string' && ['mcp_tool_call', 'network_request'].includes(type);
}

/** @param {unknown} command */
export function isUnauditableMemoryPayloadCommand(command) {
  return Boolean(
    !exactCommandTokens(command) &&
      /(?:^|\/)harness\.mjs\b[^\n]*\bmemory\b[^\n]*--payload-file\b/i.test(String(command ?? '')),
  );
}
