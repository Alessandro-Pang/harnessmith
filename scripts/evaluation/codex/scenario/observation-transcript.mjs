import { join, relative } from 'node:path';
import { parseJsonlEvidence, visibleAgentMessages } from '../support/transcript.mjs';

/** @param {unknown} stdout */
export function jsonEvents(stdout) {
  return parseJsonlEvidence(stdout).events;
}

/** @param {{ result?: import('../support/types.mjs').HostResult } | null | undefined} turn */
export function completedCommandItems(turn) {
  return jsonEvents(turn?.result?.stdout).flatMap((event) =>
    event.type === 'item.completed' && event.item?.type === 'command_execution'
      ? [
          {
            command: String(event.item.command ?? ''),
            aggregatedOutput: String(event.item.aggregated_output ?? ''),
            exitCode: event.item.exit_code,
            status: event.item.status,
          },
        ]
      : [],
  );
}

/** @param {{ result?: import('../support/types.mjs').HostResult } | null | undefined} turn */
export function turnAgentMessages(turn) {
  return jsonEvents(turn?.result?.stdout ?? '').flatMap((event) =>
    event.type === 'item.completed' && event.item?.type === 'agent_message'
      ? [String(event.item.text ?? '')]
      : [],
  );
}

/** @param {{ result?: import('../support/types.mjs').HostResult } | null | undefined} turn */
export function turnVisibleAgentMessages(turn) {
  return visibleAgentMessages(turn?.result?.stdout ?? '');
}

/** @param {{ result: import('../support/types.mjs').HostResult }} turn */
export function turnCommands(turn) {
  const events = jsonEvents(turn.result.stdout);
  const started = events.flatMap((event) =>
    event.type === 'item.started' && event.item?.type === 'command_execution'
      ? [String(event.item.command ?? '')]
      : [],
  );
  if (started.length > 0) return started;
  return events.flatMap((event) =>
    event.type === 'item.completed' && event.item?.type === 'command_execution'
      ? [String(event.item.command ?? '')]
      : [],
  );
}

/** @param {unknown} content @param {string} key */
export function scalar(content, key) {
  return String(content ?? '')
    .match(new RegExp(`^${key}: ["']?([^"'\\r\\n]+)["']?$`, 'm'))?.[1]
    ?.trim();
}

/** @param {{ repo: string, markdownFiles: (directory: string) => string[], safeReadFile: (path: string, maxBytes?: number) => import('../support/types.mjs').SafeReadState, digest: (content: string | Buffer) => string, evaluatorErrors: string[] }} config */
export function createSessionSnapshots(config) {
  const { repo, markdownFiles, safeReadFile, digest, evaluatorErrors } = config;

  /** @param {string} sessionBase */
  function sessionSnapshots(sessionBase) {
    const root = join(repo, '.agent-docs');
    return markdownFiles(root).flatMap((path) => {
      const state = safeReadFile(path, 256 * 1024);
      if (!state.ok) {
        evaluatorErrors.push(`cannot snapshot session file ${path}: ${state.error}`);
        return [];
      }
      const content = state.text;
      if (scalar(content, 'session-base') !== sessionBase) return [];
      const reference = `memory:${relative(root, path).replace(/\.md$/, '')}`;
      return [
        {
          path,
          reference,
          status: scalar(content, 'status'),
          reason: scalar(content, 'checkpoint-reason'),
          digest: digest(content),
          content,
        },
      ];
    });
  }
  return sessionSnapshots;
}
