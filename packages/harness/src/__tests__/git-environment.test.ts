import assert from 'node:assert/strict';
import { test } from 'vitest';
import { sanitizeGitEnvironment } from '../lib/filesystem/git-environment.js';

test('sanitizeGitEnvironment drops redirection variables from a polluted base', () => {
  const env = sanitizeGitEnvironment({
    PATH: '/bin',
    GIT_DIR: '/tmp/other.git',
    GIT_WORK_TREE: '/tmp/other',
    GIT_INDEX_FILE: '/tmp/index',
    GIT_CONFIG: '/tmp/config',
    GIT_CONFIG_PARAMETERS: 'foo.bar=baz',
    GIT_CONFIG_COUNT: '1',
  });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.GIT_INDEX_FILE, undefined);
  assert.equal(env.GIT_CONFIG, undefined);
  assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});
