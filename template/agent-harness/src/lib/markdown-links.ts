import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

export function markdownLinkTargets(content: string): string[] {
  const targets: string[] = [];
  visit(fromMarkdown(content), ['link', 'image', 'definition'] as const, (node) =>
    targets.push(node.url),
  );
  return targets;
}
