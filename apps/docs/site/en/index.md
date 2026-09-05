---
title: Harnessmith documentation
description: Distribute and safely manage a personal Agent Harness across coding-agent hosts
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en
---

# Harnessmith documentation

Harnessmith is an npm initializer that distributes one personal Agent Harness across Codex, Cursor, Claude Code,
OpenCode, Kimi Code CLI, and Zed Agent. It provides an ownership-checked, recoverable installation flow with backups,
restore, and uninstall — while leaving model execution, tools, sandboxing, and approvals to the host.

Think of it this way: if you use multiple coding agents and have spent weeks curating rules, debugging workflows,
and documenting hard-won lessons, those accumulated insights live in your `AGENTS.md` files, chat histories, and
personal notes. Harnessmith turns that scattered experience into a structured, installable, and verifiable local
work layer. You install it once, and it works across all your hosts — no cloud sync, no API keys, no new runtime
to maintain. Historical documents remain available for traceability, but routing keeps unrelated history out of the
model context by default.

"Local work layer" is worth unpacking. It's not a cloud service: no network dependency, no account system, no
server-side data to leak or lose. It's not an IDE plugin either, so it doesn't lock you into a specific editor. And
it's not a prompt template that evaporates with each chat. It's closer to a work environment you build for yourself:
a clear entry point (rule files), layered content (core boundaries up front, detailed procedures loaded on demand),
state tracking (where tasks stand), and safety guarantees (you can recover if an install goes wrong). Individually
none of these are novel; together they form a way of working that can evolve over time.

Start with the [English getting-started guide](/en/getting-started). The Chinese documentation is the canonical source
for the complete technical design, and several pages are available only in Chinese. This isn't a translation gap we're
embarrassed about. It's a deliberate choice. Maintaining parallel deep-dive translations is expensive, and stale
translations are worse than no translations: readers follow outdated instructions and lose trust in the whole docs.
We'd rather point you to the canonical source and let you decide whether to read it in Chinese or use machine
translation, than leave an English copy that quietly goes stale.

The following pages cover the core technical content and are currently available only in Chinese:

- [Host support](/guide/hosts) (Chinese)
- [Lifecycle](/guide/lifecycle) (Chinese)
- [Architecture](/concepts/architecture) (Chinese)
- [Responsibility and security boundaries](/concepts/boundaries) (Chinese)
- [CLI reference](/reference/cli) (Chinese)
- [Contributing](/maintain/contributing) (Chinese)

The repository also provides a concise
[English README](https://github.com/Alessandro-Pang/harnessmith/blob/main/README.en.md)
that covers positioning, installation, and common operations, enough to get you started without reading the full
documentation.
