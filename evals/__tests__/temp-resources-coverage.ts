import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { temporaryResourceReport } from '../../scripts/temporary-resources/temp-resources.js';
import { withTemporaryWorkspace } from '../../src/temporary-resources/temporary-resource.js';

const base = mkdtempSync(join(tmpdir(), 'harnessmith-script-coverage-'));
try {
  withTemporaryWorkspace(
    {
      base,
      owner: 'preflight',
      purpose: 'script-coverage',
      lifecycle: 'operation',
    },
    (workspace) => {
      const root = dirname(workspace.path);
      temporaryResourceReport(['--root', root]);
      temporaryResourceReport(['--root', root, '--json']);
    },
  );
} finally {
  rmSync(base, { recursive: true, force: true });
}
