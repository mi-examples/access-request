# Access Request

A Metric Insights **Custom App** at `/p/access-request` that asks a requester the governance
questions for one asset, records their answers as an auditable ledger, and hands the request off to
an external approval portal via a scheduled Custom Script.

React 19 · TypeScript · Vite via `@metricinsights/pp-dev` · TanStack Query.
Development target: **beta7.metricinsights.com**.

---

## Scope

**The App is the questionnaire.** Discovery and selection stay in Metric Insights: locked tiles in
the catalog, folders and Global Search, the ⓘ tooltip and the Access Denied card are all native and
configuration-only, so there is nothing there worth rebuilding. The App is entered with the asset
already chosen and asks about that one asset.

It renders **inside MI**, below MI's own navigation bar — `pp-dev.config.ts` sets `mi.mode:
'embedding'`, and the App's *Display without Metric Insights navigation bar* setting is left
unchecked. So it draws no chrome of its own, inherits MI's stylesheet and fonts, and follows the
signed-in user's Brand Theme.

```
MI catalog → locked tile → "Request Access"
                              │  /p/access-request?element=<id>
                              ▼
        asset detail → questionnaire → review → outcome        ( · my requests )
```

One asset per request, one request at a time — which is also all MI's approval path can honour:
`setRequestStatus` grants a single tile and then marks every tile in the request accepted, so a
batched request would report success for content it never granted.

---

## Why it is shaped this way

Four platform constraints determine the architecture. Each is load-bearing, so they are worth knowing
before changing anything.

**Custom Fields hold the questions; an App Dataset holds the answers.** A custom field stores exactly
one value per element — the upsert key is `(custom_field_id, item_id, item_type)`, with no user,
request or version dimension, so requester B's answer would overwrite requester A's with no history
and no attribution. Writing one also requires Edit access on the element, which a blocked requester
by definition lacks. So the question bank and the answer *schema* live in Custom Fields, and the
answer *rows* live in an App Dataset.

**Two kinds of conditionality, only one of them native.** `custom_field_rule` evaluates against a
value stored *on the asset*, which makes it a perfect fit for *"Tier 3 assets need the detailed
justification questions"* and no fit at all for *"you answered Yes, so now answer these three"*.
Asset-driven rules are resolved server-side and arrive already applied; respondent-driven branching is
declared in the admin-editable `questionMap` Dataset and evaluated by the App.

**The question set needs a service account to resolve.** `GET /api/custom_field_value?element=N` is
the only endpoint that applies both the `used_for_*` scoping and `checkVisibility()` — and it requires
view access on the element, which is precisely what the requester is asking for. Custom Script A calls
it as its own service account.

**Nothing interactive runs on a Custom Script.** The runner closes a run if 30 seconds pass since the
last successful MI API call, every script shares one headless Chromium with the email digest and image
export, and there is no concurrency cap. So submission is asynchronous: the App writes the ledger and
returns, and a scheduled Custom Script drains the queue to the portal out of band.

Full reasoning, with source citations, is in the architecture spec this was built from.

---

## Layout

```
src/
  config.ts               App slug, entity names, cache policy, status vocabulary
  api/
    http.ts               fetch wrapper — concurrency gate, MI error taxonomy
    mi-api.ts             element_info detail card, native request_access
    page-api.ts           App Entities: auth/info, Custom Script, App Datasets, drafts
    queries.ts            TanStack Query hooks and cache keys
  domain/
    question-map.ts       merges the resolved set with questionMap; branch evaluation
    persona.ts            derives Requester Type from groups and custom attributes
    policy.ts             reads the Group A policy fields off the detail card
    validation.ts         required-ness and MI's own answer constraints
    submission.ts         builds and writes the answer + header rows
  state/
    router.tsx            hash router (History API would 404 under /p/); ?element= entry
    draft-store.tsx       in-progress answers, persisted server-side per element
  screens/                home · asset-detail · questionnaire · review · outcome · my-requests
  components/             layout, primitives, question field renderer
custom-scripts/
  resolveQuestions.js     Script A — synchronous, read-only question resolution
  drainSubmissions.js     Script B — scheduled outbound drain
docs/
  MI-SETUP.md             the MI-side configuration, in build order
```

---

## Running it

```bash
npm install
npm run dev
```

`pp-dev` serves the App locally and proxies everything else — `/api/*`, `/data/page/*` — through to
the MI instance, reusing your browser's MI session cookie. So the App calls MI's real APIs in
development exactly as it will in production: no CORS, no token, no mocks.

Open it with an element, the way a real launch link does:
`http://localhost:3000/p/access-request?element=29`

Optional `.env`:

```
MI_BACKEND_URL=https://beta7.metricinsights.com
MI_APP_ID=123               # the portal_page_id, for template variables and sync
MI_ACCESS_TOKEN=…           # Personal Access Token, for `pp-dev sync` only
```

You need to be signed in to that MI instance in the same browser.

```bash
npm run build          # dist/ + dist-zip/access-request.zip — needs MI_APP_ID
npm run build:bundle   # dist/ only, no MI instance required (CI, or before the App exists)
npm run lint
npm run format
```

`pp-dev` refuses to start or build without `MI_APP_ID`, because a standalone App is identified by its
`portal_page_id` on the instance. Create the App first (`docs/MI-SETUP.md` §1); `build:bundle` produces
the same `dist/` in the meantime.

---

## Deploying

Upload `dist-zip/access-request.zip` on the App's **Assets** tab, or use Git Sync.

The build is already MIME-safe for MI's asset server: `.js` only (no `.mjs`), no source maps, fonts
inlined as data URIs rather than emitted, and `base` set to `/p/access-request/`. MI's MIME map covers
`js json css png jpg gif svg ico` and nothing else; anything outside it is served with an empty content
type that the browser reads as `text/html` and refuses.

Asset ingestion is a **destructive full replace** of the App's prior assets, and there is no
per-file upload.

Point the pilot Category's Access Denied Message at `/p/access-request?element=<id>` — that link is
the App's entry contract and the one thing that must be configured. `docs/MI-SETUP.md` §2 covers it,
along with everything else on the MI side.

---

## Making it yours

The App follows **Metric Insights' own design system** rather than carrying a brand of its own, so out
of the box it looks like the page the requester just came from. Everything organisation-specific is
either configuration in MI or one of the six places below.

| What | Where | Notes |
|---|---|---|
| Accent colour | **Nothing to change — set a Brand Theme in MI.** The App reads `--theme-palette-primary-main` and friends from `/auth/theme-vars.css` | Fallbacks live in `src/styles/app.css` as `--mi-primary` etc., used only when the App runs outside MI's layout |
| Page title | `src/components/layout.tsx` | The one line of chrome the App draws: "Request Access" |
| Request status vocabulary | `src/config.ts` → `REQUEST_STATUS`, and the three `STATUS_*` vars in `custom-scripts/drainSubmissions.js` | **Must match the destination portal's own strings.** Keep both files in step |
| Policy custom-field labels | `src/config.ts` → `POLICY_FIELD` | Match to the Custom Fields you author in MI. Matching is case- and whitespace-insensitive, so only a genuine rename needs a change here |
| Contact pre-fill labels | `src/domain/persona.ts` → `contactPrefill` | Relabel `Username:` to whatever your directory identifier is called (NetID, UPN, employee number) |
| Persona source attributes | `src/domain/persona.ts` → `PERSONA_ATTRIBUTE_KEYS` | The user Custom Attributes searched for a persona value; `eduPersonAffiliation` is included by default |

Everything else that varies between organisations is **data, not code**: the question bank and its
option lists are Custom Fields, the branching rules and required flags are rows in the `questionMap`
Dataset, and the classification that drives tier and routing is Custom Field values on each asset.
None of it needs a rebuild. See `docs/MI-SETUP.md`.

### Where the design system comes from

`src/styles/app.css` restates MI's MUI theme as plain CSS. Two rules govern it, both consequences of
rendering inside MI's page:

- **Every selector is scoped under `.ar-app`.** MI's whole stylesheet is already on the page, and the
  App sits in `.main-side` next to MI's chrome. An unscoped `body`, `input`, `.row` or `.card` rule
  here would restyle the host. The design tokens live on `.ar-app` rather than `:root` for the same
  reason.
- **Colour is read from the running instance, not hard-coded.** `/auth/theme-vars.css` publishes the
  user's resolved Brand Theme as `--theme-*` properties, which is how MI's own stylesheets theme
  themselves. The alpha ramps are re-derived from those with `color-mix()`, so a different primary
  carries through every wash, border and focus ring rather than only the solid fills.

Each block names the file it came from, so the two can be reconciled when MI's theme moves:

| MI source | What this App takes from it |
|---|---|
| `frontend/src/theme/core/design.ts` | Palette, the `alpha(text.primary, …)` ramp, 12px/1.5 type, 3px radius, 28px control height, 8px spacing, the `#075B7E` top bar |
| `…/mui-components/mui-button.ts` | 28×80px minimums, `3px 12px` padding, contained / outlined / text variants, no shadow |
| `…/mui-components/mui-input.ts` | 1px `rgba(34,34,34,.4)` border, teal *value* text, the 2px focus ring, placeholder hidden on focus |
| `…/mui-components/mui-typography.ts` | The teal-underlined section heading — MI's most recognisable element |
| `…/mui-components/mui-alert.ts` | Square-cornered notices, `5px 12px`, an 8% wash of the severity colour |
| `…/mui-components/mui-checkbox.ts` | The checked mark, reusing MI's own inline SVG |
| `…/mui-components/mui-tabs.ts`, `mui-tab.ts` | The questionnaire's step list |
| `…/mui-components/mui-table-cell.ts` | The single 16% bottom rule on table rows |

**Inter is not bundled.** MI loads it itself (`mui-css-base-line.ts` imports `@fontsource/inter` 400
and 600) and the App renders inside MI's page, so it inherits the faces. This also sidesteps a dead
end: MI's asset MIME map has no `woff`/`woff2` entry, so a font shipped with the App could only ever
be delivered as an inlined data URI. Running outside MI's layout, the stack falls back to Arial —
MI's own declared fallback.

---

## Contracts worth not breaking

| Contract | Where | Consequence of drift |
|---|---|---|
| `?element=<id>` launch parameter | the Access Denied Message ↔ `src/state/router.tsx` | The App has no asset to ask about |
| `.ar-app` scope class | `src/components/layout.tsx` ↔ every selector in `src/styles/app.css` | Styles leak into MI's own chrome, or the App renders unstyled |
| `mi.mode` ↔ *Display without MI navigation bar* | `pp-dev.config.ts` ↔ the App's editor page | Development stops resembling production: a duplicated nav bar, or a missing one |
| `@@MIJSON@@…@@ENDJSON@@` sentinel | `src/api/page-api.ts` ↔ both Custom Scripts | The App cannot read the script's output |
| `APP_SLUG = 'access-request'` | `src/config.ts` ↔ `drainSubmissions.js` | Script B reads the wrong App's entities |
| `REQUEST_STATUS` values | `src/config.ts` ↔ `drainSubmissions.js` | Rows are never drained, or drained twice |
| `POLICY_FIELD` labels | `src/config.ts` ↔ the Custom Fields in MI | Tier, route and turnaround stop displaying |
| Question label = `custom_field.name` | MI ↔ `questionMap.question_key` | Branching and required flags stop applying |

---

## Known limits

- **Status goes stale after submission** until the approval portal's webhook writes back. There is no
  poll — building one would spend the 100 requests/minute budget for very little.
- **Persona gating in the UI is advisory.** A determined user could reveal a question meant for
  another persona. That is a cosmetic exposure rather than a breach: questions are not secrets, and
  the answers are re-validated at drain time before anything is provisioned.
- **Required-ness is enforced by the App, then re-checked at drain time.** There is no submit-time
  server-side check, because at 7.2.1 the App→Custom Script call carries no user identity. Deferring
  is safe because nothing is provisioned until approval.
- **Nothing expires a grant.** Tier 3's time-bound access is recorded in `expires_on` but not
  enforced; enforcing it would need a scheduled revocation job.
