import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveSkillsHome } from '../installation/skills.js';

test('skills home follows USERPROFILE on Windows and HOME on POSIX', () => {
  const env = { HOME: 'C:\\custom-home', USERPROFILE: 'D:\\profile' };
  assert.equal(resolveSkillsHome(env, 'win32'), 'D:\\profile');
  assert.equal(resolveSkillsHome(env, 'linux'), 'C:\\custom-home');
});
