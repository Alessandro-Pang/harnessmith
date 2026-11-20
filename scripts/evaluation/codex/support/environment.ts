const inheritedEnvironmentKeys = new Set([
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
]);

const harnessEnvironmentKeys = new Set([
  'HARNESS_MEMORY_HOME',
  'HARNESS_PERSONAL_HOME',
  'HARNESS_REPOSITORY_ROOT',
  'HARNESS_RELEASE_ARTIFACT',
  'HARNESS_EXPECTED_PACKAGE_SHA256',
  'HARNESS_TEST_CODEX_CAPTURE',
]);

function allowedEnvironmentKey(key: string): boolean {
  if (inheritedEnvironmentKeys.has(key) || harnessEnvironmentKeys.has(key)) return true;
  if (!/^HARNESS_(?:EVAL|TEST)_[A-Z0-9_]+$/u.test(key)) return false;
  return !/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|COOKIE|PRIVATE|AUTH|API_KEY)/u.test(key);
}

/** Build the complete child environment; never merge the ambient process environment implicitly. */
export function createEvalEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  ambient: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const source of [ambient, overrides]) {
    for (const [key, value] of Object.entries(source)) {
      if (allowedEnvironmentKey(key) && typeof value === 'string') environment[key] = value;
    }
  }
  return environment;
}
