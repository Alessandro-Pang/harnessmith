import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
  lang: 'zh-CN',
  title: 'Harnessmith',
  description: '跨宿主分发和安全管理个人 Agent Harness',
  base: '/harnessmith/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://alexpang.cn' },
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: { label: 'English', lang: 'en', link: '/en/' },
  },
  head: [['meta', { name: 'theme-color', content: '#176b5b' }]],
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
          text: '认识 Harnessmith',
          items: [
            { text: '它解决什么问题', link: '/guide/why-harnessmith' },
            { text: 'Harness Engineering', link: '/concepts/harness-engineering' },
          ],
        },
        {
          text: '开始使用',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '宿主支持', link: '/guide/hosts' },
            { text: '生命周期', link: '/guide/lifecycle' },
          ],
        },
        {
          text: '理解设计',
          items: [
            { text: 'Harnessmith 如何工作', link: '/concepts/how-it-works' },
            { text: '架构', link: '/architecture' },
            { text: '设计原则', link: '/concepts/design-principles' },
            { text: '责任与安全边界', link: '/concepts/boundaries' },
            { text: 'Memory 与 Task', link: '/concepts/memory-and-tasks' },
            { text: '证据与评测', link: '/concepts/evidence-and-evaluation' },
          ],
        },
        {
          text: '维护与贡献',
          items: [
            { text: '安装器 CLI', link: '/reference/cli' },
            { text: '运行时 CLI', link: '/reference/runtime-cli' },
            { text: '临时资源', link: '/temporary-resources' },
            { text: '版本与迁移', link: '/versions/migrations' },
            { text: '贡献指南', link: '/contributing' },
            { text: '内容策略', link: '/content-strategy' },
            { text: '历史与思想来源', link: '/project/history-and-influences' },
            { text: '参考资料', link: '/references' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Alessandro-Pang/harnessmith' }],
    editLink: {
      pattern: 'https://github.com/Alessandro-Pang/harnessmith/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Harnesssmith contributors',
    },
  },
}));
