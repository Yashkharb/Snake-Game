// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://yashkharb.github.io',
  base: '/Snake-Game/',
  vite: {
    plugins: [tailwindcss()],
    build: {
      minify: 'esbuild',
      target: 'es2020',
    },
  },
});