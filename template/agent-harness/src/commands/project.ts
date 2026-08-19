import { projectSnapshot } from '../lib/project.js';
import type { Io, ProjectSnapshot } from '../types.js';

export function inspectProject(
  input = process.cwd(),
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): ProjectSnapshot {
  const snapshot = projectSnapshot(input);
  if (json) {
    io.log(JSON.stringify(snapshot, null, 2));
    return snapshot;
  }
  io.log(`Project: ${snapshot.root}`);
  io.log(`Git: ${snapshot.isGitRepository ? 'yes' : 'no'}`);
  if (snapshot.branch) io.log(`Branch: ${snapshot.branch}`);
  if (snapshot.head) io.log(`HEAD: ${snapshot.head}`);
  if (snapshot.dirty !== null) io.log(`Working tree: ${snapshot.dirty ? 'dirty' : 'clean'}`);
  io.log(`Agent memory: ${snapshot.memory.initialized ? 'initialized' : 'not initialized'}`);
  io.log(`Package manager: ${snapshot.packageManager || 'unknown'}`);
  io.log(`Manifests: ${snapshot.manifests.join(', ') || 'none'}`);
  io.log(`Nearest AGENTS: ${snapshot.agents.join(', ') || 'none'}`);
  return snapshot;
}
