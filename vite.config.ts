import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * MI serves a standalone App's assets from `/p/<internal_name>/<relative path>`
 * (`PortalPage::processRequest` → `returnAsset`), so the bundle's public base
 * must match the App's URL exactly.
 *
 * MI's asset MIME map covers `js json css png jpg gif svg ico` and nothing
 * else — `mjs`, `map`, `woff`, `woff2` and `wasm` all fall through to an empty
 * content type, which the browser treats as `text/html` and strict ES-module
 * MIME checking then rejects. The build below therefore emits `.js` only, no
 * source maps, and no font files.
 */
export default defineConfig({
  base: '/p/access-request/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Inline small assets, to avoid an extra asset row and an extra request
    // against the 100 req/min throttle shared by `/p/` and `/data/page/*`.
    // Anything that stays a file must have an extension MI's MIME map knows —
    // if you ever add a font, inline it, because `woff`/`woff2` are not in it.
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
