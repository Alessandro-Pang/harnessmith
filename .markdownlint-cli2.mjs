export default {
  config: {
    default: true,
    MD013: false,
    MD024: { siblings_only: true },
    MD025: false,
    MD033: false,
  },
  gitignore: true,
  globs: ['**/*.md'],
  ignores: [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    'template/agent-harness/dist/**',
    '.pet-runs/**',
  ],
};
