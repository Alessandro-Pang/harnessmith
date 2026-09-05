---
title: 文档贡献
description: 文档站点的本地开发、质量检查与发布流程
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
---

# 文档贡献

本文说明如何修改、预览和验证 Harnessmith 文档。它面向提交文档 PR 的贡献者；给项目贡献代码见[项目贡献](/maintain/contributing)，项目通用贡献规则仍以仓库根目录的 [`CONTRIBUTING.md`](https://github.com/Alessandro-Pang/harnessmith/blob/main/CONTRIBUTING.md) 为准。

## 先确定改哪一层

| 需求 | 应修改的位置 | 判断标准 |
| --- | --- | --- |
| 第一次认识项目、安装和最短成功路径 | 根目录 `README.md` / `README.en.md` | 读者读完能决定是否使用并开始安装 |
| 使用步骤、宿主差异、故障排查 | `apps/docs/site/zh/guide/` | 用户需要按步骤完成一件事 |
| 原理、边界、设计取舍 | `apps/docs/site/zh/concepts/` | 读者需要理解“为什么这样做” |
| 命令、参数和退出码 | `apps/docs/site/zh/reference/` | 读者需要查一个准确的接口 |
| 贡献流程、内容规则和证据 | `apps/docs/site/zh/maintain/` | 维护者需要修改或审核文档 |
| 仅供工程讨论的草稿 | 根目录 `docs/` | 内容还不是对外承诺 |

先改事实源，再改说明文字。代码、schema、测试和 manifest 决定实际行为；文档解释使用场景、边界和恢复方式，不能用措辞替代实现。

## 本地预览

环境要求：Node.js `24.12.0` 或更高版本，以及仓库声明的 pnpm 版本。

```bash
pnpm install --frozen-lockfile
pnpm run docs:dev
```

开发服务器默认监听 `5173`。提交前构建一次发布产物：

```bash
pnpm run docs:build
pnpm run docs:preview
```

`docs:build` 检查 VitePress 页面、生成搜索索引和静态资源；`docs:preview` 用构建后的文件启动本地预览。构建通过并不等于外部网站、第三方链接或真实宿主行为已经验证，后者需要单独的检查或 Host Eval 证据。

## 提交前检查

推荐按下面的顺序执行：

```bash
pnpm run docs:check
pnpm exec vitest run --config config/vitest.config.ts packages/cli/src/__tests__/docs-site.test.ts
pnpm run lint:md
pnpm run preflight
```

各命令的责任不同：

- `docs:check`：检查站点能否构建，以及 VitePress 能发现的内部页面链接；
- `docs-site.test.ts`：检查关键页面、frontmatter、导航事实、README 命令和内容契约；
- `lint:md`：检查 Markdown 语法和格式；
- `preflight`：执行仓库级类型、测试和质量门禁。

下列项目不会由上述命令自动证明，改动相关内容时要单独核对：

- 外部网站和 GitHub 链接是否仍可访问；
- sitemap 的 hostname、`base` 路径和 GitHub Pages 部署地址；
- `public/` 中发布的 YAML、图片和下载文件；
- 命令示例是否能在当前构建产物上执行；
- 真实 Host 的模型、工具权限、认证和宿主事件。

网络或宿主条件不足时，结果写成 `inconclusive`，不要写成“已验证”。

## 修改事实时同步测试

如果 CLI 命令、默认值、宿主能力、路径、环境变量、状态名或证据文件发生变化，请在同一变更中检查：

1. 相关指南和参考页；
2. README 中的最短路径和安全边界；
3. `docs-site.test.ts`、schema 或 preflight 中锁定旧事实的断言；
4. `apps/docs/site/public/` 中需要随源文件发布的静态资源。

测试失败时先判断是实现变了还是文档写错。事实发生变化就更新断言并说明原因；文档写错就修正文档。不要为了让检查通过而删除覆盖范围。

## 页面写作标准

每页尽量按同一条阅读路径组织：

1. 开头说明这页解决什么问题、适合谁，以及不能证明什么；
2. 先给最短可执行步骤，再解释原因和内部机制；
3. 命令附近说明前置条件、是否写入、成功结果和失败后的下一步；
4. 用“已实现 / 由宿主负责 / 不支持 / `inconclusive`”区分事实等级；
5. 首次出现的术语给出解释，后文保持同一写法；
6. 结尾保留限制、恢复入口和相关页面链接。

标题使用动作或清晰名词，段落一次只解决一个问题。避免“可以帮助用户更好地……”等无法验收的空话，也不要用营销语气掩盖限制。

页面 frontmatter 至少包含 `title`、`description`、`owner`、`audience`、`status` 和 `updated`。`updated` 只在事实或结构发生变化时更新。

## 发布流程

Pull Request 只构建站点，不会自动发布。合并到 `main` 后，Docs workflow 才会上传静态产物并部署到 [https://alexpang.cn/harnessmith/](https://alexpang.cn/harnessmith/)。

发布前应确认：

- 构建产物中的 sitemap 包含 `/harnessmith/` base 路径；
- `public/` 文件在产物中存在；
- 中英文入口的导航语言和链接正确；
- 代码、文档和测试对同一事实没有冲突。
