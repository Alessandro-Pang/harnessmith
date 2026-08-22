# Contributing

Thanks for helping improve Harnessmith. Keep changes small, portable, and evidence-backed.

## Development

Requirements: Node.js 24.12 or newer, pnpm 10.13.0, and Git.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run format
pnpm run preflight
pnpm run test:coverage
npm pack --dry-run
```

The final command verifies the npm distribution manifest; repository dependency and script workflows use pnpm.

Add or update tests for every behavior change. Installation changes should cover fresh install, conflict,
upgrade, rollback, restore, and uninstall paths as applicable. Changes under `template/` must keep the
host-neutrality test passing.

## Architecture boundaries

- Host names, paths, formats, and environment variables belong in `src/adapters.ts` or other outer
  installation code.
- Runtime source is strict TypeScript under `src/` and `template/agent-harness/src/`. Generated `dist/`
  files are build products: change the TypeScript source and run `pnpm run build`; never edit them directly.
- Biome is the shared formatter and linter, Knip rejects unreachable files or exports, and Secretlint scans
  source plus prompt/document surfaces for known credential formats. Run `pnpm run format` after source
  changes; `pnpm run check` rejects quality drift before rebuilding the published runtimes.
- Markdownlint checks repository documentation. `scripts/preflight.ts` checks package and CLI contracts plus
  Harness document routing, frontmatter, relative links, template tokens, and host-neutrality.
- Vitest owns unit and integration tests. Its V8 gate covers imported runtime and release helpers; c8 merges
  coverage from the preflight and eval CLI subprocesses. Both thresholds are regression floors.
- Keep tests beside their owning code under `src/__tests__/`,
  `template/agent-harness/src/__tests__/`, or `evals/__tests__/`; do not recreate a root `test/` directory.
  Changes to the embedded runtime require focused tests under its own `__tests__/` directory; run them with
  `pnpm run test:harness`. End-to-end installation tests do not replace source-level command and library tests.
- `template/` is the portable Harness core and must not identify a specific host product.
- Stable rules go in the compact instruction template; detailed workflows go in routed Harness docs.
- `.agent-docs` is non-authoritative memory, never the only source of project facts or rules. The personal
  overlay is user-owned and lives outside managed installation outputs.
- Prefer maintained libraries for generic infrastructure, but keep Harness domain rules local. Dependencies used
  only by the embedded runtime belong in `devDependencies` and must be bundled; Agent homes must not need a
  second package installation.

Commitlint enforces Conventional Commits through the Husky `commit-msg` hook. The `pre-commit` hook checks
staged code and documentation; `pre-push` runs the full `pnpm run preflight`. New branches should match
`(feature|hotfix|refactor)/YYYYMMDD_<feature-name>`; preflight allows the long-lived `main`, `master`, and
`develop` branches and validates every other named branch against that pattern.
