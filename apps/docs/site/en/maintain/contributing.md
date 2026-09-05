---
title: Contributing
description: Local development, quality checks, and the release process for the documentation site
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
lang: en
---

# Contributing

This page explains how to modify, preview, and verify the Harnessmith documentation. It is aimed at contributors
submitting documentation PRs; the project's general contribution rules are still defined by
[`CONTRIBUTING.md`](https://github.com/Alessandro-Pang/harnessmith/blob/main/CONTRIBUTING.md) at the repository root.

## Decide which layer to change first

| Need | Where to make the change | How to decide |
| --- | --- | --- |
| First contact with the project, installation, and the shortest path to success | `README.md` / `README.en.md` at the repository root | After reading, readers can decide whether to use the project and start installing |
| Usage steps, host differences, and troubleshooting | `apps/docs/site/zh/guide/` | Users need to complete a task step by step |
| Principles, boundaries, and design trade-offs | `apps/docs/site/zh/concepts/` | Readers need to understand "why it is done this way" |
| Commands, parameters, and exit codes | `apps/docs/site/zh/reference/` | Readers need to look up an exact interface |
| Contribution workflow, content rules, and evidence | `apps/docs/site/zh/maintain/` | Maintainers need to change or review documentation |
| Drafts for engineering discussion only | `docs/` at the repository root | The content is not yet an external commitment |

Change the source of truth first, then the explanatory text. Code, schemas, tests, and manifests determine actual
behavior; documentation explains use cases, boundaries, and recovery, and wording can never substitute for
implementation.

## Local preview

Environment requirements: Node.js `24.12.0` or newer, and the pnpm version declared by the repository.

```bash
pnpm install --frozen-lockfile
pnpm run docs:dev
```

The dev server listens on `5173` by default. Build the release artifacts once before committing:

```bash
pnpm run docs:build
pnpm run docs:preview
```

`docs:build` checks the VitePress pages and generates the search index and static assets; `docs:preview` starts a
local preview from the built files. A passing build does not mean external websites, third-party links, or real host
behavior have been verified; those require separate checks or Host Eval evidence.

## Checks before committing

The recommended order is:

```bash
pnpm run docs:check
pnpm exec vitest run --config config/vitest.config.ts packages/cli/src/__tests__/docs-site.test.ts
pnpm run lint:md
pnpm run preflight
```

Each command has a different responsibility:

- `docs:check`: verifies that the site builds, plus the internal page links that VitePress can discover;
- `docs-site.test.ts`: checks key pages, frontmatter, navigation facts, README commands, and content contracts;
- `lint:md`: checks Markdown syntax and formatting;
- `preflight`: runs the repository-level type, test, and quality gates.

The following items are not proven automatically by the commands above; verify them separately when you change
related content:

- whether external websites and GitHub links are still reachable;
- the sitemap hostname, the `base` path, and the GitHub Pages deployment address;
- the YAML, images, and download files published under `public/`;
- whether the command examples run against the current build artifacts;
- the model, tool permissions, authentication, and host events of a real host.

When network or host conditions are insufficient, record the result as `inconclusive`, not as "verified".

## Sync tests when facts change

If CLI commands, defaults, host capabilities, paths, environment variables, state names, or evidence files change,
check the following in the same change:

1. the related guide and reference pages;
2. the shortest paths and security boundaries in the READMEs;
3. assertions in `docs-site.test.ts`, schemas, or preflight that pin the old facts;
4. static assets under `apps/docs/site/public/` that need to be published alongside the source files.

When a test fails, first determine whether the implementation changed or the documentation is wrong. If the facts
changed, update the assertion and explain why; if the documentation is wrong, fix the documentation. Do not delete
coverage just to make a check pass.

## Page writing standards

Organize every page around the same reading path where possible:

1. the opening states what problem the page solves, who it is for, and what it cannot prove;
2. give the shortest executable steps first, then explain the reasons and internal mechanics;
3. near each command, state the preconditions, whether it writes, the success result, and the next step after a
   failure;
4. distinguish fact levels with "implemented / delegated to the host / unsupported / `inconclusive`";
5. explain terms on first use, and keep the same wording afterwards;
6. end with limitations, recovery entry points, and links to related pages.

Headings use actions or clear nouns, and each paragraph addresses one problem at a time. Avoid unverifiable filler
like "helps users better …", and don't use a marketing tone to gloss over limitations.

Page frontmatter includes at least `title`, `description`, `owner`, `audience`, `status`, and `updated`. Update
`updated` only when facts or structure change.

## Release process

A pull request only builds the site; it does not publish automatically. Only after merging into `main` does the Docs
workflow upload the static artifacts and deploy to
[https://alexpang.cn/harnessmith/](https://alexpang.cn/harnessmith/).

Confirm the following before releasing:

- the sitemap in the build artifacts contains the `/harnessmith/` base path;
- the `public/` files exist in the artifacts;
- the navigation language and links are correct for both the Chinese and English entry points;
- code, documentation, and tests do not conflict about the same facts.
