import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'DnD Table',
        short_name: 'DnD',
        description: 'Digital character sheets for our in-person D&D sessions',
        theme_color: '#7f1d1d',
        background_color: '#1c1917',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Never cache the realtime connection.
        navigateFallbackDenylist: [/^\/socket\.io/, /^\/api/],
      },
    }),
  ],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': 'http://localhost:3001',
    },
  },
});
