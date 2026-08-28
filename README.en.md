# Harnessmith

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** · [简体中文](./README.md)

Harnessmith is a local-first, cross-host Personal Harness distribution and work-state control plane. It safely
installs the same working rules, progressive documentation, memory protocol, and task-state tools across Codex,
Cursor, Claude Code, and OpenCode.

```bash
npx harnessmith
```

Configure once, work consistently everywhere. Your coding agents get a shared understanding of how to start
tasks, when to load context, how to protect existing work, and what evidence is required before completion.

## Why Harnessmith

Each coding agent has different instruction files, scopes, and directory layouts. Maintaining them by hand
usually leads to drifting rules, overwritten personal content, and lost context when long tasks move between
sessions.

Harnessmith separates those concerns into four layers:

| Layer | Responsibility |
| --- | --- |
| Instructions | Compact, always-loaded rules for high-cost mistakes |
| Progressive docs | Task-specific procedures loaded only when needed |
| Memory & work state | Non-authoritative memory, a compact user profile, and resumable task state |
| Installer safety | Preflight, backups, validation, locks, and rollback |

| Capability state | Boundary |
| --- | --- |
| Implemented | Cross-host distribution, safe installation lifecycle, progressive context, non-authoritative memory, resumable task state, and privacy-safe runtime audit |
| Delegated to the Host | Model loop, tool execution, sandbox, permission prompts, cost controls, and event streams |
| Unsupported | A general Agent Runtime, automatic rule rewriting, Policy Engine, Pack/Registry, and multi-agent orchestration |

Markdown instructions are guidance; enforcement remains with the installer, tests, CI, and the host permission
system.
See the [capability claim-evidence matrix](./docs/capability-evidence.yaml) for each claim's owner, state,
implementation, and verification paths.

## Start in 30 seconds

Node.js 24.12 or newer is required.

```bash
# Choose agents interactively
npx harnessmith

# Or install directly for Codex
npx harnessmith --agent codex

# Preview every destination and action before writing
npx harnessmith --agent all --project /absolute/path/to/repository --dry-run
```

After installation, Harnessmith initializes:

- the host instruction entry point and embedded Harness CLI;
- the user-owned `~/.agent-harness` personal overlay;
- cross-project personal memory under `~/.agent-docs` by default;
- a compact current-user profile, limited to 32 in-place entries.

> [!NOTE]
> **Installing with an LLM or coding agent**
>
> Send the prompt below directly to your AI. It will read [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt) from the npm `latest` package first, then follow the installation flow, target checks, permission boundaries, and failure-handling rules from that same release channel.
>
> `Read https://unpkg.com/harnessmith@latest/llms.txt first, then install Harnessmith for me from the npm latest channel by following its protocol.`

## Supported agents

| Agent | Active instruction entry | Harness directory | Scope |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md` | `$CODEX_HOME/agent-harness` | Global |
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md`, with `AGENTS.md` retained | `$CLAUDE_CONFIG_DIR/agent-harness` | Global |
| OpenCode | `$OPENCODE_CONFIG_DIR/AGENTS.md`; otherwise `${XDG_CONFIG_HOME:-~/.config}/opencode/AGENTS.md` | `agent-harness` under that config root | Global |
| Cursor | `<project>/.cursor/rules/agent-harness.mdc` | `<project>/.cursor/agent-harness` | Project |

Cursor file-based rules are project-scoped. Pass `--project` for the intended repository. Harnessmith adds
only its managed files to the repository-local Git exclude file and `.cursor/.ignore`; it never hides or
overwrites the team's entire `.cursor/` directory.

## Common operations

```bash
# Install one or several agents
npx harnessmith install --agent codex
npx harnessmith --agent codex,cursor,claude,opencode --project /absolute/path/to/repository

# Emit stable JSON Lines for automation
npx harnessmith --agent all --project . --dry-run --json

# Read adapter scope, activation, and enforcement owners without writing
npx harnessmith capabilities --agent all --json

# Inspect ownership and file integrity
npx harnessmith status --agent all --project .

# Restore the previous installation layer
npx harnessmith restore --agent codex

# Restore every layer to the pre-install state
npx harnessmith uninstall --agent codex

# Aggregate runtime, installation, and global-memory health after installation
node <harness-path>/bin/harness.mjs health --json

# Let a Host explicitly submit runtime metadata without raw content
node <harness-path>/bin/harness.mjs audit record --payload-file /absolute/event.json --json
```

Pass `health --project <absolute-path>` only after that project's memory has been initialized with
`init project`; an uninitialized project-memory root is not an unhealthy installation.

`audit record` is a Host-neutral explicit ingestion point. Harness stores only trace, operation, policy decision,
duration, outcome, artifact digests, and optional token/cost metadata; it rejects the raw prompt, model output,
and tool arguments. The Host still owns production of model-loop, tool, and permission events, and Harness does
not observe an unintegrated runtime automatically. `audit maintain` reports retention candidates without writing;
`audit archive` is proposal-first and moves complete daily files into retained storage only with `--apply`.

`restore` and `uninstall` preserve shared/project `.agent-docs` and the user-owned personal overlay.
`--yes` disables interaction and selects Codex when no agent was provided; it does **not** authorize file
conflicts. Use `--force` only after reviewing the target and accepting backup-based takeover.

## What you get

### Progressive instructions

The always-loaded `AGENTS.md` keeps only high-cost, non-inferable defaults. Detailed procedures for diagnosis,
review, changes, releases, Git, and tool routing are loaded by task type. Host-loaded project rules may refine
project work, but cannot expand permissions or weaken safety requirements.

The embedded `route` / `explain` commands use manifest triggers to return only matching document names, paths,
and triggers without loading bodies. Search `--limit` only caps returned matches; scanning has independent entry,
directory, depth, file, per-file byte, aggregate byte, and time budgets. JSON `scanLimits` and `--help` are the
authoritative defaults. JSON also includes provenance, `scanTruncated`, `scanStats`, and structured skip reasons,
while human output reports incomplete scans.

### Layered memory

Harnessmith deliberately separates how an agent works, who the user is, what happened before, and what is
currently true about a project:

| Location | Content | Boundary |
| --- | --- | --- |
| Host-native memory | Historical signals recalled by the host | Input to verify, never the current Harness profile |
| `~/.agent-harness` | User-maintained personal rules and repository relationships | A rule overlay, not memory; preserved across upgrades and uninstall |
| `~/.agent-docs/profile.md` | Current identity, working style, technical background, preferences, and interests | The only current user profile inside the Harness; only cross-task `explicit/high` signals update automatically, with pause and forget controls |
| `~/.agent-docs/core.md` and other global memory | Cross-project active topics, experience, and distilled findings | Name-level routing, sources, and context; never a second current profile |
| `<project>/.agent-docs` | Project input, sessions, work state, evidence, distilled findings, and archive | Reviewable but non-authoritative; contains local ignore files and does not modify project-root ignore configuration |
| `docs/`, ADRs, code, tests, schemas, lint, and CI | Current project facts, accepted decisions, and executable constraints | Authoritative; stable conclusions are promoted here |

Project `.agent-docs` uses a progressively disclosed minimal model:

```text
.agent-docs/
├── core.md                 # Active topics and high-value memory routes
├── inputs/                 # User wording, attachments, and acceptance criteria
├── sessions/               # Session history, handoffs, unfinished work, next actions
├── working/                # Plans, research, reviews, state, and task ledgers
├── distilled/              # Expensive findings distilled across episodes, with sources
├── evidence/               # Redacted tests, logs, and screenshot manifests
└── _archive/               # Completed, superseded, or low-heat memory
```

The content is classified as `input`, `episode`, `working`, `distilled`, or `evidence`; `core.md` is the index.
Long-task objectives, checkpoints, acceptance criteria, and next actions live in
`working/<task-id>/task.json`, while stable facts still move to the authoritative layer. Memory supports
`active`, `blocked`, `complete`, `superseded`, and `archived` lifecycle states, plus validation, search,
supersede, archive, and proposal-only promotion. `memory check --indexed` rejects active or blocked memory
that cannot be reached from an index, while `memory maintain` reports unindexed, expired working,
archive-ready entries, duplicate active titles, supersession cycles, and legacy, generic-action, or workstream
inputs that need review without changing them.

`memory list --json` and `memory check --json` expose versioned machine contracts. Legacy metadata changes only
through explicit `memory migrate --set ...`: it emits a proposal by default and accepts `--apply` only after the
reviewed result is `ready`. Initialization, task-progress updates, and Memory write commands serialize on a
shared memory-root lock.

Memory Autopilot gives agents typed, low-noise writes without repeated user prompting. `capture-input --payload-file`
stores only future-decision-relevant constraints, acceptance criteria, sources, risk decisions, or explicitly
retained input, with an explicit verbatim/summary mode and workstream/durable lifecycle. `close-input` removes
expired input from the active index. `capture-experience` reconciles sourced lessons and failures,
`handoff` / `close-handoff` maintain unfinished work, and
`reconcile-profile` / `forget-profile` / `profile-autopilot` maintain a pausable current profile. One-shot actions
such as commit, publish, or continue are not Important Inputs by default, while short durable prohibitions are not
discarded by a length threshold. Inputs are
deduplicated by exact text for verbatim input or normalized text for reliable summaries, plus source and mode.
Commands reject high-confidence secrets, update
exact index references, validate managed memory, and roll back failed writes. Every automatically generated
free-text value is written with a non-shell file API and passed through `--payload-file`; untrusted text is never
interpolated into a shell command. Routine automatic `created`, `updated`, and `unchanged` results are not
announced separately, while `proposed` and `blocked` are reported briefly; explicit profile controls receive a
brief result. Local `host-evals/` artifacts are checked by `eval:validate`, but a scenario or unit test is not evidence
that behavior passed in a real host.

Here, "learning/evolution" means auditable memory adaptation, not model-weight training or autonomous
changes to prompts, skills, rules, or source code. Those changes still require explicit authority,
review, and verification.

Handoffs do not depend on a host shutdown hook. A verified stage with follow-up work, a host context-budget or
compression signal, or a material change to `completed/decisions/open/verification/next` that makes the current
snapshot insufficient triggers a check. Before writing, the agent reads the current handoff and active task;
only confirmed resolved or superseded content is cleared, and ambiguous state is preserved. A host thread/task
id is preferred as the stable session base, so one workstream replaces its latest active generation instead of
accumulating a transcript. Finished work with no follow-up is closed; a later task on the same base creates the
next deterministic generation while preserving the older episode. The closed generation is
removed from the active index.

Project memory is initialized only when workspace writes are authorized and a task needs cross-session handoff,
unfinished state, or redacted evidence. Small questions and one-off changes do not trigger initialization;
uninitialized read-only projects report expensive findings as proposals. Agents read `core.md` and names/metadata first, then
follow explicit references without loading the full tree or archive by default. Matching cross-project topics
route through the global Memory `core.md`. The canonical `profile.md` is a bounded exception: each new host
task/thread reads it once before beginning work so existing cross-task preferences can be applied. A new distilled
memory remains a proposal without a typed flow or current write authorization. Tasks that cross the persistence
threshold resolve internally to `proposed`, `created`, `updated`, `unchanged`, or `blocked`: routine automatic
`created`, `updated`, and `unchanged` stay quiet, while `proposed` and `blocked` are reported briefly. Task commands
keep long-running work reachable from `core.md`, and promotion is complete only after the formal document is
actually written and verified.

### Maintainable repository map

The personal overlay stores a described repository catalog and typed direct edges in
`projects/repository-map.yaml`; `repository-map.md` is only its deterministic generated view.
`harness repository-map check` validates the schema, direction, two-sided evidence, and size budgets.
`discover packages --apply` idempotently maintains direct local package dependencies, `verify --record`
stores source fingerprints and freshness below host `state/`, and `maintain` reports drift without mutation.
External or heuristic observations remain proposals and cannot gain write authority by claiming to be
deterministic.

### Durable task ledgers

The embedded Harness CLI stores objectives, next actions, checkpoints, and acceptance evidence. A task can
enter `complete` only through its acceptance gate, and concurrent updates are protected by task locks.
`task verify` proves only that the caller-selected mechanical check ran, its evidence is fresh, and its scope
stayed stable during execution. It does not infer whether that evidence is semantically relevant to a
free-text criterion, and it is not a tamper boundary. Evidence is bound to its task and criterion, so an
unchanged cross-task copy is rejected, but direct ledger edits or verifier replacement remain outside the
threat model. For high-risk acceptance, use a user-reviewed or CI/Host-owned verifier whose predicate cannot
be replaced by the current task, then invoke it through `task verify`. External evidence can be only `failed`
or `inconclusive`; it cannot directly pass the gate.

### Safe installation lifecycle

- Complete staging and JavaScript syntax checks before replacement.
- Lexical and canonical containment for output, backup, record, and ignore paths.
- Fail-closed handling of symlinks, junctions, and reparse paths below authorized roots.
- Refusal of unmanaged or user-modified targets by default.
- Cross-process locks and complete preflight for multi-agent operations. On failure, Harnessmith attempts
  rollback along recorded paths; an incomplete rollback reports an error and retains recovery paths rather
  than claiming atomic restoration.
- Preservation of mutable `state/`; upgrades, restore, and uninstall never overwrite the personal overlay.

See the [architecture and enforcement model](./docs/architecture.md) and [security policy](./SECURITY.md) for
the complete boundaries.

<details>
<summary><strong>Automation options and exit codes</strong></summary>

`--agent` is repeatable and accepts `codex`, `cursor`, `claude`, `claude-code`, `opencode`, and `all`. Non-interactive
calls should select agents explicitly and use `--json` when a stable machine protocol is required.

`capabilities` is a read-only command that neither resolves installation paths nor writes files. Dry-run,
install-result, and status JSON include the same Adapter `capabilities` describing scope, activation, file
ownership, and the permission owner. `--no-init-global` skips shared global-memory initialization but never
skips the personal overlay.

JSON failures are emitted as one stderr object containing `version`, `error.code`, `message`, and `exitCode`:

| Exit code | Meaning |
| ---: | --- |
| 1 | Unclassified internal error |
| 2 | CLI usage error |
| 3 | Safety or integrity refusal |
| 4 | Operation-lock contention |
| 5 | No actionable installation state |

</details>

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Purpose | Default |
| --- | --- | --- |
| `CODEX_HOME` | Codex installation target | `~/.codex` |
| `CLAUDE_CONFIG_DIR` | Claude Code installation target | `~/.claude` |
| `OPENCODE_CONFIG_DIR` | OpenCode config and installation target | `${XDG_CONFIG_HOME:-~/.config}/opencode` |
| `HARNESS_MEMORY_HOME` | Cross-project personal memory | `~/.agent-docs` |
| `HARNESS_PERSONAL_HOME` | User-owned rules and repository map | `~/.agent-harness` |
| `HARNESS_REPOSITORY_ROOT` | Repository collection root | `~/git-repo` |
| `HARNESS_OWNER` | Owner rendered into memory templates | Current user |

Host-specific variables stay inside their installation adapters and never enter the host-neutral Harness
template or runtime contract.

</details>

## Develop from source

The repository uses Node.js 24.12+ and pnpm 10.13.0. Root `dist/` and
`template/agent-harness/dist/` are generated artifacts and must not be edited directly.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node bin/harnessmith.mjs --help
pnpm run preflight
pnpm run test:harness
pnpm run test:coverage
npm pack --dry-run
```

Biome, Markdownlint, Commitlint, Vitest, lint-staged, and Husky provide the quality gates. Dependency
installation, script orchestration, and CI use pnpm; `npm pack --dry-run` exists only to verify the final npm
distribution manifest.

## Read more

- [Architecture and enforcement model](./docs/architecture.md)
- [Contributing guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Release process](./RELEASING.md)
- [Changelog](./CHANGELOG.md)
- [LLM installation protocol (npm latest)](https://unpkg.com/harnessmith@latest/llms.txt)

---

If you want every coding agent to work with the same care, recoverability, and evidence standards,
Harnessmith is the shared personal infrastructure layer.
