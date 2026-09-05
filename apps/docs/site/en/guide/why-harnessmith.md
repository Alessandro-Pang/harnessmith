---
title: Why Harnessmith
description: Multi-host rule drift, amnesia on long-running tasks, and unsafe installs explain why Harnessmith is shaped this way
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# Why Harnessmith

Before installing any tool, three questions are worth asking: what problem it solves, how completely it solves
it, and what it costs to use. This page is organized as problem → solution → cost → fit, so you can make that
judgment before installing.

Harnessmith is for people who use one or more coding agents and intend to maintain their way of working over
the long term. It creates no new model capabilities. Plainly put, it does only one thing: turn the working
constraints that easily scatter across configuration, chats, and personal experience into a local work layer
that can be safely installed, read on demand, and continuously verified.

The idea of a "local work layer" is worth expanding. Harnessmith's installed work layer doesn't depend on
cloud services; it isn't an IDE plugin tied to a particular editor; nor is it a set of prompt templates
discarded with each chat. It's closer to a working environment you build for yourself: a clear entry point
(the rules file), layered content (core boundaries up front, detailed procedures loaded on demand), state
records (how far a task has gotten), and safety guarantees (a broken install can be restored). None of these
pieces is novel alone; combined, they form a way of working that can evolve over the long term.

A note on its origins, to avoid a wrong impression: it was not designed up front from a Harness Engineering
theory. At first the goal was simply to extract the `AGENTS.md` conventions, docs retrieval, and
work-recording methods already proving effective in real projects, so they could be reused across projects and
coding agents; the boundaries around hosts, authorization, Memory, lifecycle, and verification emerged
gradually during that generalization. For the actual order of evolution, see
[History and influences](/en/concepts/history-and-influences).

## The problem isn't writing one fewer rules file

Picture a common opening: in Codex you stipulate that read-only analysis must not modify files; two weeks
later you add test commands in Cursor; then you record the release process in Claude Code. A few more weeks
pass, the three rule sets have each evolved, and none of them is complete. When you switch to a new project or
a new host, you can no longer say which one is the latest, so you dictate it all over again.

The pain point in this scenario isn't duplicated labor — it's drift. The three rule sets start from the same
point and move further apart over time. You change one and forget the other two; or you add a new rule in one
host and forget that the others need it too. Months later you no longer know which copy is complete and which
is outdated, and you're left judging from memory — precisely the least reliable part.

The most intuitive fix is merging everything into one giant `AGENTS.md`. That road doesn't go far: once the
always-loaded context grows long, the most critical security boundaries get buried under piles of detail, and
the model becomes more likely to miss them; concrete procedures still go stale, and the longer the file gets,
the less anyone dares to change it. What really needs managing isn't a more complete rules file but a system:
a stable entry point, on-demand docs, host adaptation, recoverable installs, work state, and verification
evidence.

Loading on demand is the key to this system. Core security boundaries (such as "no push without permission")
go up front and are loaded in every session; concrete procedures (such as a pre-release checklist) live in
separate documents and are read only when needed. This keeps critical constraints from being drowned out
while letting detailed content expand fully, without worrying about exceeding the context budget.

One more constraint is easily overlooked: historical documents can't simply be deleted to shrink a directory.
They record how decisions and approaches evolved; once they're gone, you can never again explain why something
was done that way at the time. But they also shouldn't enter every conversation by default — otherwise large
amounts of outdated, weakly related, or even mutually conflicting content crowd out the model context and
raise the risk of misjudgment and hallucination. So the right question is how to keep history while sending
only the currently needed parts into the context, not how much to delete.

## Before install: rules and state each drift

Day-to-day work without a Harness concentrates its problems in five places:

- Every host separately maintains its own rule paths and formats, so each change has to be synced again; drift
  is a matter of time, not luck.
- The rules file carries both the security boundaries and every operations manual; content with two very
  different lifespans is squeezed into one file that becomes harder and harder to read.
- Long-running tasks survive on chat history; after context compression or a session switch, goals, progress,
  and acceptance criteria are easily lost.
- Upgrading personal configuration relies on scripts overwriting files directly, with no fallback after a
  failure; restoring the original state is basically luck.
- "The agent says it's done" and "the result has been mechanically verified" are conflated; acceptance rests
  on trust, not evidence.

None of these problems is fatal alone; stacked together they hand your way of working over to luck. This week
you might not step into a pitfall; next week, when you switch hosts or open a new task, the problems you've
accumulated can all surface at once.

## After install: a maintainable work layer takes shape

After installing, the same scene looks like this:

- One host-neutral Harness is distributed through Adapters to multiple coding agents; rules are maintained in
  one place, and drift disappears at the source.
- The short entry point keeps only high-loss rules and routing; detailed procedures are loaded when needed.
  The entry point is always a map, never an encyclopedia.
- The Repository Map in the Personal overlay stores sourced repository responsibilities and direct
  relationships, so cross-project tasks can locate the owner, contracts, and release boundaries directly
  instead of relying on memory.
- Memory keeps leads awaiting verification; Task keeps goals, checkpoints, acceptance criteria, and evidence.
  The two are deliberately separated.
- You can dry run before installing; writes go through preflight, locks, staging, backups, and rollback on
  failure, with a clear way out at every failed step.
- Capability declarations distinguish implemented, host-owned, and unsupported; documentation advice is never
  dressed up as technical enforcement, and the promise is exactly as large as the claim.

## The costs of three design choices

Tool documentation should also state clearly what was given up. These three points are the result of
deliberate choices:

- **No cloud sync.** Local-first buys offline availability and a privacy boundary; the cost is that moving
  between devices relies on manual migration via `export` / `import`. This choice also means there is no
  account system. Your data stays entirely on your machine — there is no server side that could leak or lose
  it.
- **No enforcement.** Markdown rules only guide behavior; real enforcement lives in code, schemas, tests, and
  the host's permission system. The cost is that "writing a rule" never equals "the rule will necessarily be
  obeyed". Rules are guidance for people and agents, not physical barriers. Real safety comes from layered
  defenses, not from writing "forbidden" in a document.
- **No automatic learning.** Memory never auto-promotes into rules or gets written into source code;
  consolidation must go through proposals and review, and the cost is that you occasionally have to confirm a
  promotion by hand. Automatic promotion looks convenient, but it easily misjudges one-off context as a
  long-term rule and pollutes the knowledge base instead. Manual confirmation adds a step but protects the
  quality of what enters the store.

## What it's suited for

Putting it together, Harnessmith fits: a personally maintained, cross-project coding-agent working
environment; day-to-day work with multiple coexisting hosts; long-running tasks that routinely span sessions;
strict Git and release boundaries; and a working style that wants to consolidate experience into retrievable
documents rather than endlessly growing prompts.

Conversely, if you only use one agent occasionally and a few lines of project notes are enough, maintaining a
short `AGENTS.md` directly is the lighter, correct answer. It also isn't a team-level cloud control platform:
it provides no model service, no multi-agent scheduling, and no centralized permission system — those are the
responsibility of another class of tools.

To decide whether to use it, consider three questions: Do you often switch between multiple coding agents?
Have you accumulated a batch of rules and experience scattered across places? Have you encountered situations
like "task state lost halfway through" or "a configuration upgrade overwrote files"? If all three answers are
yes, Harnessmith will most likely fit; if all are no, introducing it at this stage would be a burden instead.
