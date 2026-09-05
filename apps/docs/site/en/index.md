---
layout: home
title: Harnessmith documentation
description: Distribute and safely manage a personal Agent Harness across coding-agent hosts
owner: maintainers
audience: users
status: active
updated: 2026-09-05
lang: en

hero:
  name: Harnessmith
  text: One agent working style, running reliably across hosts
  tagline: Maintain the rules once and install them into every coding agent. Installations can be previewed and rolled back, long tasks can be resumed, and conclusions come with evidence. Models and permissions always stay with the host.
  image:
    src: /brand/harnessmith-logo.svg
    alt: Harnessmith logo
  actions:
    - theme: brand
      text: Get started in 5 minutes
      link: /en/guide/getting-started
    - theme: alt
      text: What problem it solves
      link: /en/guide/why-harnessmith
---

<!-- The custom sections below are raw HTML. VitePress adds the base prefix only to Markdown links,
     so raw HTML hrefs must spell out /harnessmith/ (keep in sync with base in config.ts) or they 404 in production. -->

<section class="home-signal" aria-label="Harnessmith overview">
  <p class="home-eyebrow">Personal Agent Harness · Local first</p>
  <div class="home-signal-grid">
    <div><strong>6</strong><span>built-in adapters</span></div>
    <div><strong>0</strong><span>silent overwrites of your files by default</span></div>
    <div><strong>1</strong><span>host-neutral working style</span></div>
  </div>
</section>

<section class="home-intro">
  <div>
    <p class="home-kicker">Why it exists</p>
    <h2>More hosts every year, rules scattered everywhere.</h2>
  </div>
  <div>
    <p>Sound familiar? The same safety boundaries written once for Codex and then rewritten for Claude Code, with one copy updated and the other forgotten; <code>AGENTS.md</code> growing longer while the agent struggles to find the constraints that matter; a task half done when the context is compacted, leaving a new session to guess how to continue; a personal setup you want to upgrade without a script overwriting files you carefully maintained.</p>
    <p>These are not model-capability problems; they are working styles with nowhere to live. Harnessmith grew out of these concrete problems: it turns rules, retrieval methods, and task records that already work in practice into a local working layer that installs safely and loads on demand. It does not replace the coding agent. How the model reasons and how tools are authorized remains the host's responsibility.</p>
    <p>The English pages mirror the Chinese documentation, which remains the canonical source. Start with the <a href="/harnessmith/en/guide/getting-started">English getting-started guide</a>.</p>
  </div>
</section>

<section class="home-bento" aria-label="Core capabilities">
  <article class="home-card home-card-hosts">
    <span class="home-card-index">01 / DISTRIBUTE</span>
    <h2>Write the rules once, use them on six hosts</h2>
    <p>The same host-neutral Harness installs into Codex, Cursor, Claude Code, OpenCode, Kimi Code CLI, and Zed Agent through adapters. Path resolution, entry placement, and format adaptation stay in the outer layer; upgrades back up the previous layer automatically.</p>
    <div class="host-list" aria-label="Supported hosts">
      <span>Codex</span><span>Cursor</span><span>Claude Code</span><span>OpenCode</span><span>Kimi Code</span><span>Zed Agent</span>
    </div>
  </article>

  <article class="home-card home-card-safe">
    <span class="home-card-index">02 / RECOVER</span>
    <h2>See it before it writes, roll back when it breaks</h2>
    <p>Every write goes through a dry-run preview first; execution then runs a full preflight, an operation lock, staging, backups, and precise rollback. Files already at the target? The default is to refuse takeover instead of overwriting silently.</p>
    <div class="safety-line" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </article>

  <article class="home-card home-card-state">
    <span class="home-card-index">03 / CONTINUE</span>
    <h2>Long tasks no longer reconstructed from chat history</h2>
    <p>Memory keeps leads worth verifying; Tasks keep goals, checkpoints, acceptance conditions, and evidence. Marking a task <code>complete</code> must pass the acceptance gate — the agent saying "done" does not count.</p>
  </article>

  <article class="home-card home-card-boundary">
    <span class="home-card-index">04 / BOUNDARY</span>
    <h2>State up front what it does not own</h2>
    <p>Model loops, sandboxes, tool execution, and permission approvals all stay on the host side. Markdown rules guide behavior; they do not enforce permissions, and the repository never dresses "the docs say so" up as "the system guarantees it".</p>
    <a href="/harnessmith/en/concepts/boundaries">View responsibility boundaries <span aria-hidden="true">→</span></a>
  </article>
</section>

<section class="home-path" aria-labelledby="home-path-title">
  <div>
    <p class="home-kicker">Start here · Choose your path</p>
    <h2 id="home-path-title">Read by the problem you want to solve now</h2>
  </div>
  <nav aria-label="Documentation reading paths">
    <a href="/harnessmith/en/guide/why-harnessmith"><span>01</span><strong>Is it right for me?</strong><small>Three recurring problems and the applicability limits</small></a>
    <a href="/harnessmith/en/guide/getting-started"><span>02</span><strong>Install it and try</strong><small>Dry-run shows the exact scope of changes first</small></a>
    <a href="/harnessmith/en/concepts/how-it-works"><span>03</span><strong>How does it run?</strong><small>The full chain from installation to task execution</small></a>
    <a href="/harnessmith/en/concepts/architecture"><span>04</span><strong>Why this design?</strong><small>The two-layer architecture and the cost of every trade-off</small></a>
  </nav>
</section>
