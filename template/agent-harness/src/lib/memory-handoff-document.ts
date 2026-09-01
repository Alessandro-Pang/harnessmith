import { basename, dirname } from 'node:path';
import { stringify } from 'yaml';
import type { Runtime } from '../types.js';
import { parseFrontmatter, parseFrontmatterDocument } from './frontmatter.js';
import { isAtxHeading } from './markdown-heading.js';
import { documentPurposeMetadata } from './memory-document-purpose.js';
import type { HandoffOptions } from './memory-handoff.js';
import type { HandoffIdentity } from './memory-handoff-identity.js';
import { canonicalHandoffSectionTitles } from './memory-handoff-options.js';

const canonicalHeadingTitles = new Set<string>(canonicalHandoffSectionTitles);
const recognizedHeadingTitles = new Set<string>([
  ...canonicalHandoffSectionTitles,
  '目标',
  '已完成变更',
  '未完成项与风险',
  '需要提升或更新的正式文档',
]);

const frontmatter = (metadata: Record<string, unknown>): string =>
  `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n`;

const optionalSection = (title: string, content: string | undefined): string =>
  content?.trim() ? `\n\n# ${title}\n\n${content.trim()}` : '';

function existingSection(content: string, title: string): string | undefined {
  if (!content) return undefined;
  const document = parseFrontmatterDocument(content);
  const headings =
    document.metadata.get('snapshot-mode') === 'replace'
      ? canonicalHeadingTitles
      : recognizedHeadingTitles;
  const lines = document.body.split(/\r?\n/);
  const indexes = lines.flatMap((line, index) => (isAtxHeading(line, 1, title) ? [index] : []));
  if (indexes.length === 0) return undefined;
  if (indexes.length > 1 || lines[indexes[0]] !== `# ${title}`) {
    throw new Error(`Handoff contains a non-canonical or duplicate section heading: ${title}`);
  }
  const [index] = indexes;
  const end = lines.findIndex(
    (line, lineIndex) =>
      lineIndex > index && [...headings].some((candidate) => isAtxHeading(line, 1, candidate)),
  );
  return (
    lines
      .slice(index + 1, end < 0 ? lines.length : end)
      .join('\n')
      .trim() || undefined
  );
}

function existingOpenSection(content: string): string | undefined {
  const canonical = existingSection(content, '未解决事项');
  if (parseFrontmatter(content).get('snapshot-mode') === 'replace') return canonical;
  const legacy = ['未完成项与风险', '需要提升或更新的正式文档'].flatMap((title) => {
    const section = existingSection(content, title);
    return section ? [`## 兼容保留：${title}\n\n${section}`] : [];
  });
  return [...(canonical ? [canonical] : []), ...legacy].join('\n\n') || undefined;
}

function reconciledSection(
  current: string | undefined,
  clear: boolean | undefined,
  existing: string,
  title: string,
  option: string,
): string | undefined {
  if (clear && current !== undefined) {
    throw new Error(`Handoff ${option} cannot be supplied and cleared together`);
  }
  if (clear) return undefined;
  if (current === undefined) {
    return option === 'open' ? existingOpenSection(existing) : existingSection(existing, title);
  }
  if (!current.trim()) throw new Error(`Handoff ${option} cannot be blank; use its clear option`);
  return current.trim();
}

function reconciledList(
  current: string[] | undefined,
  clear: boolean | undefined,
  existing: Map<string, unknown>,
  metadataKey: 'scope' | 'source-refs',
): string[] {
  if (clear && current !== undefined) {
    throw new Error(`Handoff ${metadataKey} cannot be supplied and cleared together`);
  }
  if (clear) return [];
  if (current === undefined) {
    const prior = existing.get(metadataKey);
    return Array.isArray(prior)
      ? prior.filter((item): item is string => typeof item === 'string')
      : [];
  }
  if (current.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Handoff ${metadataKey} entries must be non-empty strings`);
  }
  if (current.length === 0) {
    throw new Error(`Handoff ${metadataKey} cannot be empty; use its clear option`);
  }
  return [...new Set(current.map((item) => item.trim()))];
}

export function reconcileHandoffOptions(options: HandoffOptions, existing: string): HandoffOptions {
  const metadata = parseFrontmatter(existing);
  const status = metadata.get('status');
  if (existing && status !== 'active' && status !== 'blocked') {
    throw new Error(`Cannot update ${String(status || 'unknown')} handoff: ${options.session}`);
  }
  return {
    ...options,
    taskId:
      options.taskId ??
      (typeof metadata.get('task-id') === 'string' ? String(metadata.get('task-id')) : undefined),
    status:
      options.status ??
      (existing && (status === 'active' || status === 'blocked') ? status : 'active'),
    facts: reconciledSection(options.facts, options.clearFacts, existing, '已确认事实', 'facts'),
    decisions: reconciledSection(
      options.decisions,
      options.clearDecisions,
      existing,
      '关键决策',
      'decisions',
    ),
    verification: reconciledSection(
      options.verification,
      options.clearVerification,
      existing,
      '验证证据',
      'verification',
    ),
    open: reconciledSection(options.open, options.clearOpen, existing, '未解决事项', 'open'),
    scope: reconciledList(options.scope, options.clearScope, metadata, 'scope'),
    sourceRefs: reconciledList(
      options.sourceRefs,
      options.clearSourceRefs,
      metadata,
      'source-refs',
    ),
  };
}

export function renderHandoff(
  runtime: Runtime,
  options: HandoffOptions,
  identity: HandoffIdentity,
  memoryRoot: string,
  created: string,
  updated: string,
  existing = '',
): string {
  const previous = existing ? Object.fromEntries(parseFrontmatterDocument(existing).metadata) : {};
  return `${frontmatter({
    ...previous,
    title: options.title.trim(),
    description: `会话交接：${options.title.trim()}`,
    ...documentPurposeMetadata(options.title),
    type: 'session-handoff',
    'memory-kind': 'episode',
    status: options.status || 'active',
    owners: [runtime.owner],
    created,
    updated,
    project: basename(dirname(memoryRoot)),
    tags: ['handoff', 'autopilot'],
    scope: options.scope || [],
    'source-refs': options.sourceRefs || [],
    'source-of-truth': false,
    'fact-class': 'recovery-state',
    'expiry-policy': 'handoff-lifecycle',
    'schema-version': 1,
    'host-adapter': runtime.hostAdapter,
    'session-id': identity.sessionId,
    'session-base': identity.sessionBase,
    'handoff-generation': identity.generation,
    'session-queryable': false,
    'checkpoint-reason': options.reason,
    'snapshot-mode': 'replace',
    ...(options.taskId ? { 'task-id': options.taskId } : {}),
  })}# 当前目标\n\n${options.objective.trim()}${optionalSection('已确认事实', options.facts)}\n\n# 已完成\n\n${options.completed.trim()}${optionalSection('关键决策', options.decisions)}${optionalSection('验证证据', options.verification)}${optionalSection('未解决事项', options.open)}\n\n# 下一步\n\n${options.next.trim()}\n`;
}
