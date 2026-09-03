---
title: 贡献文档
description: 文档站点的本地开发、质量门禁与发布流程
owner: maintainers
---

# 贡献文档

项目通用贡献规则见仓库 [CONTRIBUTING.md](https://github.com/Alessandro-Pang/harnessmith/blob/main/CONTRIBUTING.md)。
本文补充文档站点的维护契约。

## 本地运行

需要 Node.js 24.12.0 或更高版本与仓库声明的 pnpm 版本。

```bash
pnpm install --frozen-lockfile
pnpm run docs:dev
```

生产构建和预览：

```bash
pnpm run docs:build
pnpm run docs:preview
```

## 提交前检查

```bash
pnpm run docs:check
pnpm run test:unit -- packages/cli/src/__tests__/docs-site.test.ts
pnpm run preflight
```

VitePress 构建会生成本地搜索索引并拒绝无效的内部 Markdown 链接。内容契约测试会检查关键页面、owner 元数据、
README 长度和最短可执行命令。

## 写作要求

- 先写使用者需要做出的判断，再补实现细节。
- 能力声明使用“已实现 / 由宿主负责 / 不支持”，并链接到代码、测试或能力证据。
- 标注版本与时间边界；无法验证的结果使用 `inconclusive`。
- 标题层级连续、链接文字有意义、代码块标注语言；交互元素必须保留键盘焦点。
- 重要架构取舍写入对应的架构、边界或维护文档，并说明背景、候选方案、决定与后果。

## 部署

Pull Request 只构建站点。合并到 `main` 后，Docs workflow 才上传静态产物并部署 GitHub Pages；PR 本身不会主动
发布。目标站点为 <https://alexpang.cn/harnessmith/>。
