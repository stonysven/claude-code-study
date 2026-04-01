import { defineConfig } from 'vitepress'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { zh } from './config/zh'
import { en } from './config/en'

export default defineConfig({
  title: 'Claude Code 源码解析',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],
  locales: {
    zh: { label: '中文', ...zh },
    en: { label: 'English', ...en },
  },
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/anthropics/claude-code' },
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
  },
  vite: {
    plugins: [
      {
        name: 'serve-data',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const match = req.url?.match(/^\/([a-z-]+\.json)$/)
            if (match) {
              const filePath = join(import.meta.dirname, '../../data', match[1])
              if (existsSync(filePath)) {
                res.setHeader('Content-Type', 'application/json')
                res.end(readFileSync(filePath, 'utf-8'))
                return
              }
            }
            next()
          })
        },
      },
    ],
    resolve: {
      alias: {
        '@data': new URL('../data', import.meta.url).pathname,
        '@components': new URL('./theme/components', import.meta.url).pathname,
      },
    },
    server: {
      fs: {
        allow: ['..'],
      },
    },
  },
})
