import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
  lang: 'zh-CN',
  title: 'Harnessmith',
  description: '跨宿主分发和安全管理个人 Agent Harness',
  base: '/harnessmith/',
  cleanUrls: true,
  // 中文源码按阅读组放在 zh/ 下，rewrites 将 zh 映射为默认语言根 URL。
  // 开发侧沉淀文档（ADR、内部提案）位于仓库根 docs/，不进入站点源码与构建。
  rewrites: {
    'zh/:rest*': ':rest*',
  },
  lastUpdated: true,
  sitemap: { hostname: 'https://alexpang.cn' },
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: { label: 'English', lang: 'en', link: '/en/' },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#176b5b' }],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/harnessmith/brand/harnessmith-logo.svg',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/harnessmith/brand/harnessmith-logo-dark.svg',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  ],
  markdown: {
    theme: {
      light: 'github-dark-high-contrast',
      dark: 'github-dark-high-contrast',
    },
  },
  mermaid: {
    theme: 'base',
    themeVariables: {
      primaryColor: '#dcebe5',
      primaryTextColor: '#16312a',
      primaryBorderColor: '#2b7564',
      lineColor: '#487066',
      secondaryColor: '#eef2ed',
      tertiaryColor: '#f7f4ea',
      fontFamily: '"Avenir Next", "Segoe UI Variable", "PingFang SC", sans-serif',
    },
  },
  vite: {
    optimizeDeps: {
      include: ['mermaid'],
    },
  },
  themeConfig: {
    i18nRouting: false,
    logo: {
      light: '/brand/harnessmith-logo.svg',
      dark: '/brand/harnessmith-logo-dark.svg',
    },
    logoLink: '/harnessmith/',
    nav: [
      { text: '认识 Harnessmith', link: '/guide/why-harnessmith' },
      { text: '开始使用', link: '/guide/getting-started' },
      { text: '理解设计', link: '/concepts/how-it-works' },
      { text: 'CLI', link: '/reference/cli' },
    ],
    sidebar: {
      '/en/': [
        {
          text: 'English',
          items: [
            { text: 'Overview', link: '/en/' },
            { text: 'Getting started', link: '/en/getting-started' },
          ],
        },
      ],
      '/': [
        {
          text: '认识与上手',
          items: [
            { text: '它解决什么问题', link: '/guide/why-harnessmith' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: 'First Value Loop', link: '/guide/first-value-loop' },
            { text: '宿主支持', link: '/guide/hosts' },
            { text: '生命周期', link: '/guide/lifecycle' },
          ],
        },
        {
          text: '理解设计',
          items: [
            { text: 'Harness Engineering', link: '/concepts/harness-engineering' },
            { text: 'Harnessmith 如何工作', link: '/concepts/how-it-works' },
            { text: '架构', link: '/concepts/architecture' },
            { text: '设计原则', link: '/concepts/design-principles' },
            { text: '责任与安全边界', link: '/concepts/boundaries' },
            { text: 'Memory 与 Task', link: '/concepts/memory-and-tasks' },
            { text: '证据与评测', link: '/concepts/evidence-and-evaluation' },
            { text: '历史与思想来源', link: '/concepts/history-and-influences' },
          ],
        },
        {
          text: '参考',
          items: [
            { text: '安装器 CLI', link: '/reference/cli' },
            { text: '运行时 CLI', link: '/reference/runtime-cli' },
            { text: '临时资源', link: '/reference/temporary-resources' },
            { text: '版本与迁移', link: '/reference/migrations' },
            { text: '参考资料', link: '/reference/references' },
          ],
        },
        {
          text: '维护与贡献',
          items: [
            { text: '贡献指南', link: '/maintain/contributing' },
            { text: '内容策略', link: '/maintain/content-strategy' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Alessandro-Pang/harnessmith' }],
    editLink: {
      pattern: 'https://github.com/Alessandro-Pang/harnessmith/edit/main/apps/docs/site/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Harnessmith contributors',
    },
  },
}));
