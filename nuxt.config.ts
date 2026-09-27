export default defineNuxtConfig({
  compatibilityDate: '2026-09-25',
  devtools: { enabled: false },
  modules: ['nuxt-og-image'],
  site: { url: 'https://squiggle.worldcomputer.art' },
  ogImage: { defaults: { width: 1200, height: 630 } },
  css: ['~/assets/editor.css'],
  routeRules: {
    '/**': {
      headers: {
        // srcdoc is allowed; sketches cannot navigate to external documents.
        'Content-Security-Policy': "frame-src 'none'; object-src 'none'; base-uri 'self'",
      },
    },
  },
  app: {
    head: {
      title: 'Squiggle Editor',
      meta: [
        { name: 'description', content: 'An independent editor for the Chromie Squiggle algorithm by Snowfro. Edit the shape, colors, and texture, or run custom code.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#f7f7f2' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})
