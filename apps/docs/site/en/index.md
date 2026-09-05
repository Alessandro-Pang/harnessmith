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

Harnessmith is an npm initializer for distributing one personal Agent Harness across Codex, Cursor, Claude Code,
OpenCode, Kimi Code CLI, and Zed Agent. It installs rules and local runtime files with ownership checks, backups,
restore, and uninstall. The host still owns model execution, tools, sandboxing, and approvals.

If you use more than one coding agent, your rules and lessons usually end up in several `AGENTS.md` files, chat
histories, and personal notes. Harnessmith puts that material into a local work layer that can be installed and
checked. You can use the same rules on each supported host without cloud sync, API keys, or a second service to run.
Historical documents stay available for reference, while routing keeps unrelated material out of the model context.

The work layer is local. Harnessmith does not provide a cloud service, account system, or editor plugin. It also is not
a prompt template that disappears with the next chat. You get a stable rule entry point, detailed procedures that are
loaded when needed, task state that survives a new session, and an install record that supports recovery. Each part is
small; the value comes from keeping them together.

Start with the [English getting-started guide](/en/getting-started). It covers a single-host installation, preview,
verification, and recovery. The Chinese pages are the maintained source for the full design and several advanced
references. They are linked explicitly below instead of being represented by partial, potentially stale translations.

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
