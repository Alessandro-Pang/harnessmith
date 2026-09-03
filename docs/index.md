---
layout: home
title: Harnessmith 文档
description: 跨宿主分发和安全管理个人 Agent Harness
owner: maintainers
hero:
  name: Harnessmith
  text: 让一套 Agent 工作方式，跨宿主可靠运行
  tagline: 安全分发个人规则、工作状态与验证习惯。你维护方法，Harnessmith 处理适配、安装、恢复和升级。
  image:
    src: /brand/harnessmith-logo.svg
    alt: Harnessmith logo
  actions:
    - theme: brand
      text: 5 分钟上手
      link: /guide/getting-started
    - theme: alt
      text: 了解设计
      link: /guide/why-harnessmith
---

<section class="home-signal" aria-label="Harnessmith 概览">
  <p class="home-eyebrow">Personal Agent Harness · Local first</p>
  <div class="home-signal-grid">
    <div><strong>7</strong><span>个已接入宿主</span></div>
    <div><strong>2</strong><span>层清晰架构</span></div>
    <div><strong>1</strong><span>套可携带工作方式</span></div>
  </div>
</section>

<section class="home-intro">
  <div>
    <p class="home-kicker">为什么需要它</p>
    <h2>项目和宿主越多，越需要一套不会失控的工作方式。</h2>
  </div>
  <div>
    <p>你是否遇到过这些情况：同一套安全边界在多个 Coding Agent 中反复维护；规则越写越长，却越来越难被准确找到；任务跨过几次上下文压缩后，下一次会话只能靠猜；升级配置时，又担心覆盖已有文件。</p>
    <p>Harnessmith 从这些实际问题中长出来：先把已经有效的规则、检索和工作文档方法做成通用工具，再为跨宿主使用补上权限边界、Memory、生命周期和验证。它不替代 Coding Agent，模型循环与权限系统仍由宿主负责。</p>
  </div>
</section>

<section class="home-bento" aria-label="核心能力">
  <article class="home-card home-card-hosts">
    <span class="home-card-index">01 / DISTRIBUTE</span>
    <h2>一套方法，适配多个宿主</h2>
    <p>Codex、Cursor、Claude Code、OpenCode、Kimi Code CLI、DeepSeek Harness 与 Pi Agent 共享宿主中立的 Harness；路径、入口和激活差异由 Adapter 处理。</p>
    <div class="host-list" aria-label="支持的宿主">
      <span>Codex</span><span>Cursor</span><span>Claude Code</span><span>OpenCode</span><span>Kimi Code</span><span>DeepSeek</span><span>Pi Agent</span>
    </div>
  </article>

  <article class="home-card home-card-safe">
    <span class="home-card-index">02 / RECOVER</span>
    <h2>写入前看得见，失败后退得回</h2>
    <p>dry-run、完整预检、操作锁、staging、备份和精确回滚共同保护已有文件。</p>
    <div class="safety-line" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </article>

  <article class="home-card home-card-state">
    <span class="home-card-index">03 / CONTINUE</span>
    <h2>长任务不只靠聊天记录</h2>
    <p>Memory 保存待核对线索；Task 保存目标、检查点、验收条件和证据。只有 acceptance gate 能让任务进入 complete。</p>
  </article>

  <article class="home-card home-card-boundary">
    <span class="home-card-index">04 / BOUNDARY</span>
    <h2>清楚说明什么不归它负责</h2>
    <p>模型循环、sandbox、工具执行和权限批准仍由宿主负责。Harnessmith 不把文档建议包装成技术强制。</p>
    <a href="/harnessmith/concepts/boundaries">查看责任边界 <span aria-hidden="true">→</span></a>
  </article>
</section>

<section class="home-path" aria-labelledby="home-path-title">
  <div>
    <p class="home-kicker">从这里开始 · Choose your path</p>
    <h2 id="home-path-title">从你现在最关心的问题开始</h2>
  </div>
  <nav aria-label="文档阅读路径">
    <a href="/harnessmith/guide/why-harnessmith"><span>01</span><strong>它是否适合我？</strong><small>问题、场景与适用边界</small></a>
    <a href="/harnessmith/guide/getting-started"><span>02</span><strong>怎样安全安装？</strong><small>从 dry-run 开始的 5 分钟路径</small></a>
    <a href="/harnessmith/concepts/how-it-works"><span>03</span><strong>一次任务怎样运行？</strong><small>安装、路由、状态与验证全链路</small></a>
    <a href="/harnessmith/architecture"><span>04</span><strong>为什么这样设计？</strong><small>分层、信任边界与工程取舍</small></a>
  </nav>
</section>
