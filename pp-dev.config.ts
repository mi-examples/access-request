import { existsSync } from 'node:fs';
import { defineConfig } from '@metricinsights/pp-dev';

// Node reads `.env` into `process.env` natively; Vite's own env loading only
// covers `import.meta.env` in the bundle, not the config file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Development server configuration.
 *
 * `pp-dev` runs Vite locally and proxies every unmatched request (including
 * `/api/*` and `/data/page/*`) through to a live MI instance, reusing the
 * browser's MI session cookie. That is what lets the App call MI's own APIs in
 * development exactly as it will in production, with no CORS and no token.
 *
 * `MI_APP_ID` is the `portal_page_id` of the App on that instance. It is only
 * needed by the dev server (to pull template variables and to power `pp-dev
 * sync`); the built bundle never reads it. Set it in `.env` once the App has
 * been created — see docs/MI-SETUP.md §1.
 */
export default defineConfig({
  mi: {
    url: process.env.MI_BACKEND_URL ?? 'https://beta7.metricinsights.com',
    // Personal Access Token, used by `pp-dev sync` only. Never bundled.
    token: process.env.MI_ACCESS_TOKEN,
    /**
     * `embedding` renders the App inside MI's own page, below the navigation
     * bar, with MI's stylesheet and fonts already loaded. It mirrors the MI-side
     * setting: on the App's editor page, leave **"Display without Metric
     * Insights navigation bar"** unchecked (`catalog_layout_ind='Y'`), which is
     * what makes MI wrap the App in `layouts/index.php`.
     *
     * `mi.include` is not set — it bundles MI's shared assets into a
     * *standalone* build, and is rejected in this mode. Embedded, those assets
     * are already on the page.
     */
    mode: 'embedding',
    apiVersion: 7,
  },
  app: {
    /**
     * `page`, not `template`: the App is its own HTML (`page_type='html'`)
     * rather than an instance of a Page Template, so MI substitutes no Page
     * Template Variables into it. All configuration reaches the App through
     * App Entities at runtime instead. (Unrelated to `mi.mode` above, which
     * decides whether MI's navigation wraps the page.)
     */
    type: 'page',
    name: 'access-request',
    id: process.env.MI_APP_ID ? Number(process.env.MI_APP_ID) : undefined,
  },
  build: {
    // The Assets tab ingests a ZIP; `pp-dev build` produces it in dist-zip/.
    zip: { fileName: 'access-request.zip' },
  },
});
