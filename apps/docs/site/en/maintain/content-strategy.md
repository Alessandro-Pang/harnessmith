---
title: Content and bilingual strategy
description: Documentation sources of truth, page structure, ownership, and Chinese-English maintenance rules
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
lang: en
---

# Content and bilingual strategy

This page defines how the Harnessmith documentation is layered, how facts are determined, how Chinese and English
content is maintained, and when tests need to be kept in sync. It is both a maintenance convention and the basis for
readers to resolve conflicts.

## Documentation layers

| Layer | Questions it answers | Content boundary |
| --- | --- | --- |
| README | What is this? Is it right for me? How do I start? | Positioning, intended audience, hosts, installation, the shortest path, a security summary, and navigation |
| Guides | How do I get something done? | Scenario-based steps, preconditions, results, failures, and recovery |
| Concepts | Why is it designed this way? Where are the boundaries? | Architecture, design trade-offs, responsibility ownership, state, and evidence models |
| Reference | How exactly is a command or field written? | Complete parameters, exit codes, configuration, migration, and machine-readable facts |
| Maintenance | How do contributors change, test, and publish? | Content standards, build gates, owners, bilingual rules, and the release process |
| Code, schemas, tests | What does the current implementation actually do? | Executable contracts, defaults, denial conditions, and regression evidence |

When there is a conflict, check the current code, schemas, tests, and manifests first, then fix the documentation;
documentation cannot elevate guarantees that the code does not provide. Tests can pin key facts, but they cannot
replace human judgment about reading order and explanation quality.

## Standard structure for each page

Public pages follow the order below by default. Sections can be added or removed for special topics, but readers
must get the conclusion first and enter the details afterwards:

1. **Purpose and scope**: state the target readers, the problem being solved, and what cannot be proven;
2. **Shortest path**: give commands or steps that can be copied directly;
3. **Results and judgment**: explain the success output, what each state means, and the next step;
4. **Explanation and boundaries**: explain the design rationale, host dependencies, limitations, and `inconclusive`
   conditions;
5. **Related entry points**: link to deeper guides, reference pages, source code, or evidence.

Next to each command, state clearly whether it is read-only or writes, the permissions it requires, and the recovery
action after a failure. Code examples should run standalone, and paths should use placeholders rather than absolute
paths from the author's machine.

## README conciseness gate

The README carries only the information a first-time reader needs, but "concise" does not mean deleting facts that
readers need to make decisions. Before removing a passage, confirm that it is
duplicated, outdated, or pure implementation detail; content that still affects installation, host selection,
security judgment, or maintenance decisions must be migrated to the corresponding guide or reference page with a
migration checklist, and navigation and tests must be synced at the same time.

Keep in the README: project positioning, intended audience, core capabilities, the host list, the shortest
installation path, common recovery commands, security boundaries, documentation entry points, and current
limitations. Complete parameters, internal implementation, and evaluation protocols go on the site.

## Bilingual rules

Chinese is the canonical version of in-depth technical content. The Chinese and English READMEs must keep the same
information architecture, core capabilities, host list, commands, and security boundaries. The English site mirrors
every public page: directory structure, commands, tables, and facts match the Chinese, and English pages carry
`lang: en` in their frontmatter. When a Chinese page changes, the corresponding English page must be synced; if a
translation is missing or stale, the English entry should link explicitly to the Chinese canonical page instead of
keeping an unmaintained old translation.

When modifying any of the following facts, both the Chinese and English entry points must be checked at the same
time:

- installation commands, default hosts, and exit codes;
- states such as `installed`, `healthy`, `host-configured`, and `host-verified`;
- host support, scopes, paths, and permission boundaries;
- the definitions of `implemented`, `delegated`, `unsupported`, and `inconclusive`.

The navigation language should match the page language. English pages may link to in-depth Chinese pages, but the
link text should clearly say "Chinese technical docs".

## Owner and sync triggers

In frontmatter, `owner` expresses maintenance responsibility, `audience` expresses the primary readers, and `status`
expresses whether the page is still a public entry point. The following changes require going back through the
documentation:

- CLI commands, parameters, defaults, and exit codes;
- Adapters, host scopes, paths, and environment variables;
- schemas, state machines, migrations, and security boundaries;
- releases, evaluations, and capability evidence;
- `public/` static assets, the site base, and navigation.

PRs should name the source of truth, the affected pages, and the verification commands; do not just write "sync the
docs".

## Hand-written, generated, and publish boundaries

Markdown, navigation, and page explanations are written by maintainers. VitePress generates HTML, the search index,
the sitemap, and assets, but generated output is not a source of truth. `apps/docs/site/capability-evidence.yaml` is
the machine-readable capability inventory; public pages link to the canonical file in the repository rather than
maintaining a copy that has no consistency gate. If the YAML ever needs to be published as a site download asset in
the future, a consistency check between the source file and the published copy must be added at the same time.

The build generates a local search index for on-site keyword retrieval; it does not provide vector semantic recall,
and it does not change the documentation sources of truth. Search results can only help locate pages; they cannot
replace checking the code, schemas, and tests.

The `docs/` directory at the repository root is for ADRs, internal proposals, and working drafts, and does not
automatically enter the public site. Internal documents may record candidate options, but public pages must state
clearly which parts are already implemented and which are still planned.

## Search and version boundaries

The site uses VitePress local search. The index is generated in the same build as the pages, does not depend on an
external search service, and does not send search terms to a server. The current approach does not provide vector
semantic recall. As the documentation grows, the local index and natural-language recall will hit boundaries; before
upgrading the search approach, record the scale, load times, and recall problems first, then compare tokenization,
fuzzy matching, or semantic retrieval.

Each page's `updated` only records when the content was last adjusted; it does not mean the page stays compatible
with every code version forever. When version differences matter, state the version or date explicitly and
re-verify against the current code, schemas, and tests.
