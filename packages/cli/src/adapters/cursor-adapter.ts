import { join } from 'node:path';
import type { Adapter } from '../shared/types.js';
import {
  type AdapterResolveContext,
  gitExcludePath,
  hostAdapter,
  projectRoot,
} from './host-adapter.js';
import { renderMdcInstructions } from './instruction-formats.js';

const cursorIgnoreLines = [
  '/skills/agent-harness',
  '/skills/agent-harness.backup-*',
  '/AGENTS.md',
  '/.harnessmith/',
  '/.harnessmith-stage-*',
  '/.harnessmith-restore-*',
  '/.harnessmith-operation.lock',
  '/rules/agent-harness.mdc',
  '/*.backup-*',
  '/rules/agent-harness.mdc.backup-*',
];

/**
 * Cursor rules are project-scoped: the project `.cursor/` receives links to the hub entry
 * and skill plus a rendered `.mdc` rule (Cursor needs frontmatter, so it cannot share the
 * entry file). Everything is excluded from Git and from Cursor indexing.
 */
export function resolveCursorAdapter({ project, hub }: AdapterResolveContext): Adapter {
  const root = projectRoot(project);
  const agentHome = join(root, '.cursor');
  const excludePath = gitExcludePath(root);
  return hostAdapter('cursor', agentHome, hub, {
    project: root,
    skillLink: true,
    renderInstructions: [
      { path: join(agentHome, 'rules', 'agent-harness.mdc'), render: renderMdcInstructions },
    ],
    localIgnoreFiles: [
      ...(excludePath
        ? [
            {
              path: excludePath.path,
              root: excludePath.root,
              preserveEmpty: true,
              lines: [...cursorIgnoreLines, '/.ignore'].map((line) => `/.cursor${line}`),
            },
          ]
        : []),
      { path: join(agentHome, '.ignore'), lines: cursorIgnoreLines },
    ],
  });
}
