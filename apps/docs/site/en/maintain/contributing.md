---
title: Project contributions
description: How to contribute code to Harnessmith — environment, boundaries, verification, and the path from Issue to release
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
lang: en
---

# Project contributions

This page covers the full workflow for contributing code to the Harnessmith project. For modifying, previewing,
and publishing the documentation site, see [Documentation contributions](/en/maintain/contributing-docs). The
project's contribution rules are defined by
[`CONTRIBUTING.md`](https://github.com/Alessandro-Pang/harnessmith/blob/main/CONTRIBUTING.md) at the repository
root; this page is a summary for getting started, and the root file wins if they disagree.

## Environment and verification

Requirements: Node.js `24.12.0` or newer, pnpm `10.13.0`, and Git.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run format
pnpm run preflight
pnpm run test:coverage
npm pack --dry-run
```

- `format`: Biome is the shared formatter and linter; run it after every source change;
- `preflight`: the repository-level gate (types, package and CLI contracts, Harness document routing, all tests);
  the `pre-push` hook runs it in full;
- `test:coverage`: the coverage gate; thresholds are regression floors and may only be kept or raised;
- `npm pack --dry-run`: verifies the npm distribution manifest; the repository itself uses pnpm for dependency and
  script workflows;
- `test:harness`: focused tests for the embedded Runtime (`packages/harness/`).

Add or update tests for every behavior change. Installation changes should cover fresh install, conflict, upgrade,
rollback, restore, and uninstall paths as applicable; changes under `template/` must keep the host-neutrality test
passing. End-to-end installation tests do not replace source-level command and library tests.

## Code layout and hard boundaries

| Location | Responsibility | Boundary that must not break |
| --- | --- | --- |
| `packages/cli/src/` | Host adapters, install transactions, backups, restore, and the release boundary | Host identity, paths, and environment variables belong only in the outer adapter layer |
| `packages/harness/src/` | Generic Harness capabilities (the embedded Runtime) | Strict TypeScript source; changes need focused tests under its own `__tests__/` |
| `packages/harness/dist/`, root `dist/` | Build products | Change the TypeScript source and run `pnpm run build`; never edit generated files directly |
| `template/` | The portable Harness core distributed with every install | Must not identify any specific host product |
| Co-located `__tests__/` | Unit and integration tests | Tests live beside their owning code in `packages/cli/src/__tests__/`, `packages/harness/src/__tests__/`, or `evals/__tests__/`; do not recreate a root `test/` directory |

To add a built-in adapter: register the host identity (canonical name, label, aliases, capabilities) in
`packages/cli/src/adapters/adapter-registry.ts`, add an exhaustive path resolver in
`packages/cli/src/adapters/adapters.ts`, and keep instruction render shapes for markdown/mdc in
`packages/cli/src/adapters/instruction-formats.ts`. Then run `pnpm run eval:schema:generate` so `host.adapter.enum`
in `evals/run.schema.json` is rewritten from the registry. Preflight runs `eval:schema:check` to reject drift, and
`packages/cli/src/__tests__/adapter-conformance.test.ts` provides shared lifecycle coverage. Do not add a dynamic
plugin loader or a Pack Registry.

Some invariants are not up for review trade-offs: managed distribution, mutable `state/`, the shared personal rules
in `~/.agent-harness/`, and the non-authoritative memory in `.agent-docs/` must stay separate; file takeover denies
`unmanaged` / `modified` targets by default, and cross-adapter operations must fully preflight first and support
rollback; a Task's `complete` can only pass through the acceptance gate, and concurrent writes must hold the task
lock. Stable rules go in the compact instruction template while detailed workflows go in routed documents;
`.agent-docs` is non-authoritative memory and never the only source of project facts or rules; the personal overlay
is user-owned and lives outside managed installation outputs.

The quality tools each own one job: Knip rejects unreachable files or exports; Secretlint scans source plus
prompt/document surfaces for known credential formats; Markdownlint checks repository documentation;
`scripts/preflight/preflight.ts` checks package and CLI contracts plus Harness document routing, frontmatter,
relative links, template tokens, and host-neutrality; the Vitest V8 gate covers imported runtime and release
helpers, and c8 merges coverage from the preflight and eval CLI subprocesses. Prefer maintained libraries for
generic infrastructure, but keep Harness domain rules local; dependencies used only by the embedded runtime belong
in `devDependencies` and must be bundled — Agent homes must not need a second package installation.

## From Issue to release

1. Start with one focused Issue containing the problem, scope, acceptance criteria, and relevant boundaries;
2. Create an Issue-linked branch named `<type>/<issue>-<slug>`, for example `feat/12-indexed-doc-search` or
   `fix/15-clean-temp-files`; `gh issue develop 12 --checkout --name feat/12-indexed-doc-search` creates and links
   it in one step;
3. Use Conventional Commits and open a Draft PR early; keep `Closes #<issue>` in the PR body, complete every
   template section, and make sure the closing Issue number matches the branch;
4. Apply `enhancement`, `bug`, or `documentation` as appropriate; use `skip-changelog` only for changes that should
   not appear in generated release notes; move the PR out of Draft after focused and full verification;
5. Squash-merge only after `PR Contract`, `CI Required`, review conversations, and acceptance criteria pass; the
   linked Issue closes through the PR keyword;
6. Tagged publication verifies npm first, then creates the GitHub Release; the publish job uploads a registry
   clean-room report that binds official metadata, integrity, provenance, downloaded bytes, and isolated smoke
   results to the exact tag. `CHANGELOG.md` remains a fixed pointer rather than accumulating release history.

Commitlint enforces Conventional Commits through the Husky `commit-msg` hook; the `pre-commit` hook checks staged
code and documentation; `pre-push` runs the full `pnpm run preflight`. Preflight accepts long-lived branches,
Dependabot branches, and the Issue-linked branch contract above.
