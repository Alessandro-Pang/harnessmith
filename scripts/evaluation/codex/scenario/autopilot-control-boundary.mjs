import { join } from 'node:path';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildAutopilotControlBoundary(context) {
  const { memory, repo, treeSnapshot, safeReadFile, evaluatorErrors, memoryAutopilotBoundaryOk } =
    context;
  const sidecarCorpus = [repo, memory]
    .flatMap((root) => {
      const tree = treeSnapshot(root, { excludeGit: true });
      return Object.entries(tree.entries).flatMap(([path, entry]) => {
        if (entry.type !== 'file') return [];
        const state = safeReadFile(join(root, path), 512 * 1024);
        if (!state.ok) {
          evaluatorErrors.push(
            `cannot scan sidecar boundary file ${join(root, path)}: ${state.error}`,
          );
          return [];
        }
        return [state.text];
      });
    })
    .join('\n');
  const storedTranscriptOrSecret =
    /# (?:Sanitized bounded|Redacted real-host) transcript|## Turn \d+|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|authorization\s*:\s*bearer|"(?:access[_-]?token|refresh[_-]?token|password|secret|cookie)"\s*:/i.test(
      sidecarCorpus,
    );
  return { storedTranscriptOrSecret, fullBoundaryOk: memoryAutopilotBoundaryOk };
}
