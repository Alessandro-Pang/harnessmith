---
title: The engineering perspective
description: A field perspective that entered the project later, and where Harnessmith sits within it
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
lang: en
---

# The engineering perspective

Conclusion first: Harnessmith was not designed from the concepts or the layered model of Harness Engineering. The
project first solved rule reuse, docs retrieval, and work records in real use; later, while generalizing, it ran into
host adaptation, authorization, Memory, lifecycle, and verification boundaries — and only looking back did these
problems turn out to be shaped almost exactly like what the industry discusses as Harness Engineering. In other words,
the concept is a coordinate system found after the fact, not a blueprint drawn in advance. It helps verify what has
already been built; it does not explain why the work was done.

For the real order of evolution, see [History and influences](/en/concepts/history-and-influences). This page only
explains the field concept itself, and how it helps you see clearly what Harnessmith currently does — and does not do.

## What Harness Engineering is

A plain question: given the same model capability, why do two agents perform so differently in practice? The answer is
usually not inside the model. The model decides "how far it can reason"; the Harness decides in what environment the
model gets which context, what it can call, how it keeps working, and how results are observed and verified.

A concrete example. Suppose two agents each complete one cross-repository refactor, with identical model capability.
The first agent starts with fewer than 20 lines of rules in its `AGENTS.md`, clearly listing each repository's
responsibility, owner, and common commands; after reading the rules it locates the right repository directly, follows
the manifest to find dependencies, runs the tests to confirm the baseline, changes the code, and runs the tests again
to verify. The second agent's entry file is stuffed with more than 200 lines mixing security rules, operation manuals,
a release record from half a year ago, and three mutually contradictory project naming conventions; it spends a large
share of its context just understanding that material, and finally picks the wrong repository — because the outdated
information says "that module has been migrated," when in reality the migration was rolled back three weeks ago.

Same model: the first agent finished the task; the second walked into a dead end. The difference is not in the model
but in the Harness: whether the context is clean, whether navigation is accurate, and whether history is labeled
correctly. For coding agents, optimizing the prompt alone is usually not enough; tool interfaces, repository
readability, permission boundaries, and feedback loops change the final outcome too.

## From prompts to a complete work system

These three terms are often used interchangeably, but they care about different problems at expanding scope. Use one
cross-repository release task to tell them apart:

- **Prompt engineering** cares about how to phrase a single request. For example, "please modify the release script"
  versus "without modifying the currently published version, add a dry-run mode for the next release, and run the
  existing release tests after the change" — the latter costs 15 more seconds of prompt writing but saves three rounds
  of back-and-forth correction.
- **Context engineering** cares about which rules, facts, and history this run should see. Does the context you give
  the agent contain the correct repository paths, the current release rules, and the reason the last release failed —
  or is it mixed with READMEs from 10 different projects?
- **Harness engineering** keeps expanding outward: how the execution environment, tools, lifecycle, observability,
  verification, and governance jointly support the task. After the release script is modified, who verifies it really
  runs? If the script fails in CI, how does the agent know it is not the script's own fault? When the task is resumed
  across sessions, where does the agent recover "how far did I get last time"?

The recent survey [Agent Harness Engineering: A Survey](https://picrew.github.io/LLM-Harness/) describes the field
with seven layers, ETCLOVG: Execution, Tool, Context, Lifecycle, Observability, Verification, Governance. To be clear,
this is a useful analytical framework, not a mature standard and not a product feature checklist. The layers affect
one another: adding tool capability widens the permission surface; extending the task lifecycle increases state,
observability, and verification demands — so no layer can be optimized in isolation.

## Where Harnessmith sits in the seven layers

| Layer | Harnessmith's current responsibility | Boundary |
| --- | --- | --- |
| Execution | Path safety, locks, transactions, and rollback during installation | The agent sandbox and command execution belong to the host |
| Tool | Progressive documentation for tool selection and authorization rules | Does not implement MCP or a tool scheduler |
| Context | Short entry point, docs routing, retrieval, and non-authoritative Memory | The host decides the final context and compression strategy |
| Lifecycle | Task, checkpoint, handoff, and acceptance gate | Does not implement a general agent loop or multi-agent orchestration |
| Observability | Accepts bounded, redacted host metadata | Does not capture host events automatically and cannot prove event authenticity |
| Verification | Repository gates; Host Eval records bound to exact candidates | Real host execution and trusted attestation stay external |
| Governance | Explicit authorization boundaries and capability owners | Runtime permission approval and credentials remain with the host and the user |

The "Boundary" column of every row matters as much as the "Responsibility" column. Harnessmith's choice is to be a
"distribution and work-state control layer for a personal Harness," not to replicate the runtime each host already
has — the real differences between hosts in models, tools, and permissions should be preserved; what can be reused is
the stable method layer.

Layer by layer:

**Execution layer**: Harnessmith owns path safety, locks, transactions, and rollback for the narrow path that is "the
install process." But when the agent actually executes commands, the sandbox is provided by the host; whether a
command is allowed, which files it can access, and whether the network is reachable are all controlled by the host.
Harnessmith does not write itself into the host's sandbox policy, and it could not.

**Tool layer**: Harnessmith's docs can tell you "this tool should only be used for read-only analysis" or "release
operations need a dry run first," but it does not implement an MCP server and does not intercept tool calls. Whether a
tool is actually invoked, and with which arguments, is the business of the host tool scheduler.

**Context layer**: this is Harnessmith's core investment. The short entry point, docs routing, retrieval, and
non-authoritative Memory jointly answer "what should the agent see." But how long the final context is, which content
gets compressed, and which gets dropped is managed by the host model. Harnessmith can offer priority suggestions; it
cannot rewrite the compression algorithm.

**Lifecycle layer**: Task, checkpoint, handoff, and acceptance gate provide persistent work state across sessions. But
Harnessmith does not implement a general agent loop (it does not control when an agent starts, pauses, or retries),
and it does not do multi-agent orchestration; those are the domain of orchestration frameworks.

**Observability layer**: Harnessmith's audit accepts bounded, redacted metadata (trace, operation, duration, result,
artifact digest) but does not capture host events automatically. Whether a tool call happened, was approved, or timed
out — those events are produced by the host. Harnessmith can only record "someone reported what"; it cannot prove
"what was reported is true."

**Verification layer**: repository gates (unit tests, preflight, schema) and Host Eval record binding are the
strongest verification Harnessmith can do. But real host execution and trusted attestation stay external. Harnessmith
can verify that a record's structure is self-consistent; it cannot prove the record came from a real host session.

**Governance layer**: Harnessmith makes authorization boundaries and capability owners explicit — the rules say
"remote writes require authorization" and "one push does not automatically include a merge." But runtime permission
approval and credential management remain with the host and the user. Writing a rule into Markdown and turning it into
enforcement in the host permission system are two different things.

## One important judgment: evaluate the model and the Harness together

When an agent fails, the cause may come from the model, or from missing context, unstable tool responses, an
unprepared environment, lost task state, or a faulty verifier. Looking only at the final answer makes attribution
hard.

An example. An agent reports "the release script tests passed," but in reality: the model fully understood the
requirement and generated the correct code, yet the test run was missing one environment variable, all tests were
skipped, and the exit code was still 0. The agent saw exit code 0 and reported success. The model made no mistake
here; the fault is in the Harness: the verifier only checked the exit code, not whether the tests actually ran.

So Harnessmith separates deterministic repository verification, real host scenarios, record structure validation, and
human review — and states clearly what each layer can prove. Deterministic repository verification can prove "the code
passed the tests in the current environment," but not "a real host ran the tests"; Host Eval can prove "one exact
candidate package completed a scenario in a real host," but one pass cannot prove all scenarios hold; record structure
validation can prove "the record format is correct," not "the record content came from a real host." Only with the
four layers separated does attribution have a basis. For details see
[Evidence and evaluation](/en/concepts/evidence-and-evaluation).
