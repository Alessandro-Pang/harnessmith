---
layout: home
title: Harnessmith 文档
description: 跨宿主分发和安全管理个人 Agent Harness
owner: maintainers
audience: users
status: active
updated: 2026-09-05

hero:
  name: Harnessmith
  text: 让一套 Agent 工作方式，跨宿主可靠运行
  tagline: 规则只维护一份，装进每个 Coding Agent。安装可预览、可回滚，长任务可续接，结论有证据。模型与权限，始终归宿主管。
  image:
    src: /brand/harnessmith-logo.svg
    alt: Harnessmith logo
  actions:
    - theme: brand
      text: 5 分钟上手
      link: /guide/getting-started
    - theme: alt
      text: 它解决什么问题
      link: /guide/why-harnessmith
---

<section class="home-signal" aria-label="Harnessmith 概览">
  <p class="home-eyebrow">Personal Agent Harness · Local first</p>
  <div class="home-signal-grid">
    <div><strong>6</strong><span>个内置 Adapter</span></div>
    <div><strong>0</strong><span>默认静默覆盖用户文件</span></div>
    <div><strong>1</strong><span>份宿主中立的工作方式</span></div>
  </div>
</section>

<section class="home-intro">
  <div>
    <p class="home-kicker">为什么需要它</p>
    <h2>宿主越换越多，规则却越写越散。</h2>
  </div>
  <div>
    <p>你是否遇到过这些情况：同一套安全边界，在 Codex 里写了一遍，到 Claude Code 还得再写一遍，改一处忘一处；`AGENTS.md` 越攒越长，Agent 却越来越难在里面找到关键约束；一个任务做到一半，上下文被压缩，新会话只能靠猜接着做；想升级个人配置，又怕脚本把辛苦攒下的文件直接覆盖掉。</p>
    <p>这些不是模型能力问题，是工作方式没有地方安放。Harnessmith 从这些实际问题中长出来：把实践中已经验证有效的规则、检索方法和任务记录，做成一套可以安全安装、按需加载的本地工作层。它不替代 Coding Agent。模型怎么推理、工具怎么授权，仍由宿主自己负责。</p>
  </div>
</section>

<section class="home-bento" aria-label="核心能力">
  <article class="home-card home-card-hosts">
    <span class="home-card-index">01 / DISTRIBUTE</span>
    <h2>规则写一次，六个宿主都能用</h2>
    <p>同一份宿主中立的 Harness，通过 Adapter 装进 Codex、Cursor、Claude Code、OpenCode、Kimi Code CLI 和 Zed Agent。路径怎么解析、入口放哪里、格式怎么适配，交给外层处理；升级时旧层自动备份。</p>
    <div class="host-list" aria-label="支持的宿主">
      <span>Codex</span><span>Cursor</span><span>Claude Code</span><span>OpenCode</span><span>Kimi Code</span><span>Zed Agent</span>
    </div>
  </article>

  <article class="home-card home-card-safe">
    <span class="home-card-index">02 / RECOVER</span>
    <h2>写之前看得见，出问题退得回</h2>
    <p>任何写入先过 dry-run 预览；真正执行时走完整预检、操作锁、staging、备份和精确回滚。目标位置已有你的文件？默认拒绝接管，而不是默默覆盖。</p>
    <div class="safety-line" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </article>

  <article class="home-card home-card-state">
    <span class="home-card-index">03 / CONTINUE</span>
    <h2>长任务不再从聊天记录里考古</h2>
    <p>Memory 保存值得核对的线索，Task 保存目标、检查点、验收条件和证据。任务要标 `complete`，必须过 acceptance gate。Agent 自己说「做完了」不算数。</p>
  </article>

  <article class="home-card home-card-boundary">
    <span class="home-card-index">04 / BOUNDARY</span>
    <h2>把不归它管的，提前说清楚</h2>
    <p>模型循环、sandbox、工具执行、权限批准，全部留在宿主一侧。Markdown 规则是行为指导，不是权限强制；仓库也不把「文档写了」包装成「系统保证了」。</p>
    <a href="/harnessmith/concepts/boundaries">查看职责边界 <span aria-hidden="true">→</span></a>
  </article>
</section>

<section class="home-path" aria-labelledby="home-path-title">
  <div>
    <p class="home-kicker">从这里开始 · Choose your path</p>
    <h2 id="home-path-title">按你现在最想解决的问题读</h2>
  </div>
  <nav aria-label="文档阅读路径">
    <a href="/harnessmith/guide/why-harnessmith"><span>01</span><strong>它适合我吗？</strong><small>三个老问题、一份适用边界</small></a>
    <a href="/harnessmith/guide/getting-started"><span>02</span><strong>先装一个试试</strong><small>dry-run 起步，五分钟走完一遍</small></a>
    <a href="/harnessmith/concepts/how-it-works"><span>03</span><strong>它是怎么运转的？</strong><small>从安装到任务执行的全链路</small></a>
    <a href="/harnessmith/concepts/architecture"><span>04</span><strong>为什么这样设计？</strong><small>两层架构与每个取舍的代价</small></a>
  </nav>
</section>
