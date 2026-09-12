export const gitRedirectVariables = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
] as const;

/**
 * Drop ambient Git redirection so a caller cannot point `git` at another
 * repository, then pin a non-interactive locale.
 */
export function sanitizeGitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of gitRedirectVariables) delete env[key];
  return {
    ...env,
    GCM_INTERACTIVE: 'Never',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C',
    NODEFAULTCURRENTDIRECTORYINEXEPATH: '1',
  };
}
