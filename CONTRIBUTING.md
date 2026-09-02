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

- Host identity metadata (canonical name, label, aliases, capabilities) belongs in
  `src/adapters/adapter-registry.ts`. Host paths, instruction file layout, environment variables, and ignore
  rules belong in `src/adapters/adapters.ts`. Instruction render shapes for markdown/mdc (and future formats)
  belong in `src/adapters/instruction-formats.ts`. Do not put host identity into `template/`.
- To add a built-in Adapter: register it in `src/adapters/adapter-registry.ts`, add an exhaustive path
  resolver in `src/adapters/adapters.ts`, then run `pnpm run eval:schema:generate` so
  `evals/run.schema.json` `host.adapter.enum` is rewritten from the registry. Preflight runs
  `eval:schema:check` (and `pnpm run eval:schema:check`) to reject drift. Rely on
  `src/__tests__/adapter-conformance.test.ts` for shared lifecycle coverage. Do not add a dynamic
  plugin loader or Pack Registry.
- Runtime source is strict TypeScript under `src/` and `template/agent-harness/src/`. Generated `dist/`
  files are build products: change the TypeScript source and run `pnpm run build`; never edit them directly.
- Biome is the shared formatter and linter, Knip rejects unreachable files or exports, and Secretlint scans
  source plus prompt/document surfaces for known credential formats. Run `pnpm run format` after source
  changes; `pnpm run check` rejects quality drift before rebuilding the published runtimes.
- Markdownlint checks repository documentation. `scripts/preflight/preflight.ts` checks package and CLI contracts plus
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

## Issue-to-release workflow

1. Start with one focused Issue containing the problem, scope, acceptance criteria, and relevant boundaries.
2. Create an Issue-linked branch named `<type>/<issue>-<slug>`, for example
   `feat/12-indexed-doc-search` or `fix/15-clean-temp-files`. `gh issue develop 12 --checkout
   --name feat/12-indexed-doc-search` creates and links it in one step.
3. Use Conventional Commits and open a Draft PR early. Keep `Closes #<issue>` in the PR body, complete every
   template section, and ensure the closing Issue number matches the branch.
4. Apply `enhancement`, `bug`, or `documentation` as appropriate; use `skip-changelog` only for changes that
   should not appear in generated release notes. Move the PR out of Draft after focused and full verification.
5. Squash-merge only after `PR Contract`, `CI Required`, review conversations, and acceptance criteria pass.
   The linked Issue closes through the PR keyword. Tagged publication verifies npm first, then creates the
   GitHub Release. The publish job uploads a registry clean-room report that binds official metadata,
   integrity, provenance, downloaded bytes, and isolated smoke results to the exact tag; `CHANGELOG.md`
   remains a fixed pointer rather than accumulating release history.

Commitlint enforces Conventional Commits through the Husky `commit-msg` hook. The `pre-commit` hook checks
staged code and documentation; `pre-push` runs the full `pnpm run preflight`. Preflight accepts long-lived
branches, Dependabot branches, and the Issue-linked branch contract above.
