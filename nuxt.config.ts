export default defineNuxtConfig({
  compatibilityDate: '2026-09-25',
  devtools: { enabled: false },
  css: ['~/assets/editor.css'],
  app: {
    head: {
      title: 'Squiggle Editor — a little room for color',
      meta: [
        { name: 'description', content: 'An independent playground for the Chromie Squiggle algorithm by Snowfro. Shape a curve, explore color, and keep every edit in its hash.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#f7f7f2' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
