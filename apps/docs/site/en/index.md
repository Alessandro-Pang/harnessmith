---
title: Harnessmith documentation
description: Distribute and safely manage a personal Agent Harness across coding-agent hosts
owner: maintainers
lang: en
---

# Harnessmith documentation

Harnessmith is an npm initializer that distributes one personal Agent Harness across Codex, Cursor, Claude Code, OpenCode,
and Kimi Code CLI. It manages installation, ownership checks, backups, restore, and uninstall while leaving model execution,
tools, sandboxing, and approvals to each host.

Harnessmith grew from practical multi-project work: reusable instructions, document retrieval, and durable work notes came
first. Harness Engineering became a useful framework later, after cross-host distribution exposed permission, memory,
lifecycle, and verification boundaries.

Start with the [English getting-started guide](/en/getting-started). The Chinese documentation is the canonical source for
the complete technical design:

- [Host support](/guide/hosts)
- [Lifecycle](/guide/lifecycle)
- [Architecture](/architecture)
- [Responsibility and security boundaries](/concepts/boundaries)
- [CLI reference](/reference/cli)
- [Contributing](/contributing)

The repository also provides a concise
[English README](https://github.com/Alessandro-Pang/harnessmith/blob/main/README.en.md).
