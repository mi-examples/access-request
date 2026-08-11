# Configuring Metric Insights for the Access Request App

Everything here is stock configuration on 7.2.1 or later — no patch, no MI code change. Work through
it in order; each section depends on the one before.

Replace `beta7.metricinsights.com` below with your own instance.

---

## 0. Prerequisites

Confirm these before starting. Each one is a hard gate on something below.

| Check | Where | Why it matters |
|---|---|---|
| `CUSTOM_SCRIPT_ENABLED` is `Y` | Admin → System → Config Variables | Both Custom Scripts refuse to run otherwise (`CustomScript::run` dies immediately) |
| `CONST_PHP_PASSWORDS_ENCRYPTED` and `ENCRYPT_PASSWORDS` are both `Y` | same | The approval-portal token is only encrypted at rest when both are on |
| `SHOW_ITEMS_WITHOUT_ACCESS` is `Y` | same | Master switch for discoverable content. With it off, the catalog is empty |
| `RESTRICT_DISCOVERABLE_CONTENT` | same | **Defaults to `Y`.** Each Category's `discover_group_mode` must then be opened up, or nothing is discoverable |
| A service account exists and is an **administrator** | Admin → Users | Script A must be admin to see the full question set past `visible_to`; Script B must be admin to call `/api/user` for drain-time validation. Scope it to exactly that |

Two things that will look like bugs if you do not expect them:

- **Administrators never see discoverable content.** MI excludes them from that path entirely, so an
  admin account browsing the catalog sees an empty list even when everything is configured correctly.
  Test with a regular user.
- **`with_custom_fields` is a strict `=== 'Y'` comparison.** `y`, `1` and `true` all silently fail and
  the response still contains `"custom_fields": null`.

---

## 1. Create the App

Admin → Apps (Portal Pages) → New.

| Field | Value |
|---|---|
| Name | Request Access |
| Internal name | `access-request` — this becomes the URL, `/p/access-request` |
| Page type | HTML |
| **Display without Metric Insights navigation bar** | **Leave unchecked** — see below |
| Restrict access | Yes, then share with the groups that may request access |

### Leave the navigation bar on

Unchecking *Display without Metric Insights navigation bar* sets `catalog_layout_ind='Y'`, which makes
MI render the App inside `layouts/index.php` rather than serving its HTML bare. That gives you three
things the App is built to rely on:

- **MI's navigation**, fixed at the top, so the requester never leaves the product. The App draws no
  bar of its own — it would duplicate MI's and push the content down twice.
- **MI's stylesheet and fonts**, already loaded. That is why the bundle ships no font files: Inter
  comes from MI's own `@fontsource/inter` import.
- **`/auth/theme-vars.css`**, which publishes the signed-in user's Brand Theme as `--theme-*` custom
  properties. The App reads those, so it follows whatever theme the instance uses instead of
  hard-coding one.

It still works with the box *checked* — the App falls back to MI's default palette and the system font
stack — but it will look like a separate application rather than part of MI.

Set `mi.mode` in `pp-dev.config.ts` to match (`'embedding'` unchecked, `'standalone'` checked), or the
dev server will not show you what production looks like.

Note the `portal_page_id` from the URL of the editor. Put it in `.env` as `MI_APP_ID` so `pp-dev` can
find it.

> `enabled_ind='N'` does **not** take an App offline — only unsharing does.

### Deployment

```bash
npm run build          # produces dist/ and dist-zip/access-request.zip
```

Upload `dist-zip/access-request.zip` on the App's **Assets** tab, or configure Git Sync (recommended).

Three constraints the build already honours, worth knowing about before anyone changes the bundler
config:

- **`.js` only.** MI's asset MIME map covers `js json css png jpg gif svg ico` and nothing else. An
  `.mjs`, `.map`, `.woff` or `.wasm` asset is served with an empty content type, which the browser
  treats as `text/html`, and strict ES-module MIME checking then rejects it. If you ever add a font,
  inline it as a data URI — there is no MIME entry that would let it be served as a file.
- **Assets cannot be uploaded individually.** ZIP is the only bulk mechanism, and ingestion is a
  destructive full replace of the App's prior assets.
- **The throttle is 100 requests/minute**, shared across `/p/`, `/pt/`, `/pl/` and `/data/page/*`.

If you use Git Sync, **always set a Webhook Secret** — `/data/service/page/webhook` has no auth
middleware and skips token validation when the secret is empty.

---

## 2. Configure the native discoverability flow first

Do this before touching the App. It is configuration only, and it is what makes there be anything to
browse.

1. **Pick a pilot Category** and open up its `discover_group_mode` to the requester groups.
2. **Set an Access Denied Message** on that Category, linking into the App (see below). Element →
   Category → ancestor is the resolution order, so one message high in the tree covers a subtree.
   Only `[More Info]` and `[Element Name]` are substituted.
3. **Brand Theme → Metadata Settings.** Choose which of the 8 sections / 24 fields appear.
   **Use the Viewer column** — the Access Denied card reads Viewer, not Info Tooltip. Tuning the
   tooltip changes nothing on the App's asset-detail screen.
4. Confirm a regular user sees locked tiles on the homepage and in Global Search. Search additionally
   needs `publicly_visible_ind='Y'` **and** `visible_in_search_ind='Y'` on the element.

### Getting the element into the App — the one thing that needs care

The App is entered with an element already chosen; discovery and selection stay in MI's own catalog.
So the launch link **must** carry the element id:

```
/p/access-request?element=<element id>
```

Set that on the **Category's Access Denied Message**. Message resolution is element → category →
ancestor, so one message high in the tree covers every asset beneath it — you do not configure this
per tile.

**Do not rely on `ACCESS_REQUEST_VIA_WEBPAGE='Y'` + `ACCESS_REQUEST_URL` alone.** It does apply
globally with no per-tile setup, but at 7.2.1 both call sites are a bare
`window.open(url, '_blank')` — **no element id, no dimension value, no user** — and that path writes
no `user_access_request_log` row either. A user who arrives that way lands on the App's "start from
the content you need" screen, which tells them (and whoever configured the link) exactly what is
missing.

`element` is the only thing the App takes from the URL. Everything else about the asset is read from
MI server-side, because URL-borne metadata is spoofable by the requester, goes stale the moment a
steward edits the asset, and would force the link to be configured per tile.

---

## 3. Author the Custom Fields

Two Custom Field Sections, two different jobs. Keep them separate.

### 3.1 Group A — Policy & classification (section: *Data Governance*)

These carry values **on each asset** and select the tier, the approval route and the SLA. Set
`display_in_access_dialog_ind='Y'` on all of them so the requester can see the classification, and
`visible_to='all'`.

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Data Domain | `single` | Finance, HR, Student, Research, … Nothing native carries this |
| 2 | Data Risk Classification | `single` | Your existing risk taxonomy — the input that derives the tier |
| 3 | Access Request Tier | `single` | `Tier 1: Aggregate (Low Risk)` · `Tier 2: Filtered (Moderate Risk)` · `Tier 3: Sensitive (High Risk)` |
| 4 | Access Type | `single` | Aggregated / Row-level / Limited datasets |
| 5 | Source System | `single` | Only if MI's own Data Source name does not already match |
| 6 | Asset Type | `single` | Only if MI's content types do not match your own taxonomy |
| 7 | Tile Type | `single` | Only if `element_type` does not match |
| 8 | Domain Data Steward | `users` | Resolves to an MI user, so the App shows a name |
| 9 | System / App Owner | `users` | |
| 10 | Approval Route | `single` | One option per destination your portal routes to — drives Script B's branch |
| 11 | Required Controls | `multi` | RBAC · RLS · Role-based views · Audit logs · Time-bound access · Full audit |
| 12 | Target Turnaround | `single` | `1–3 days` · `3–5 days` · `1–2 weeks` — shown to the requester |
| 13 | IT Assessment Required | `single` | `Y` / `N`. Gates the escalated-review step |

The App matches these by **display label**, case- and whitespace-insensitively. A genuine rename needs
`POLICY_FIELD` in `src/config.ts` updated; changing capitalisation does not.

Fields 3 and 13 are the natural antecedents for **asset-driven** `custom_field_rule` conditions.

### 3.2 Group B — The question bank (one section per wizard step)

`custom_field_section` **is** the wizard step: `display_name` is the step title and `seq` is the step
order. Set every question field to `visible_to='all'`.

Four authoring constraints that will otherwise surprise you:

1. **There is no single-line free-text type.** The six types are `single`, `multi`, `textarea`,
   `email`, `date`, `users` — and `single` is a *pick list*, not a text box. Every free-text answer
   must be `textarea`.
2. **A field definition has no "required" flag.** Required-ness lives in the `questionMap` Dataset
   (§4.2), the App enforces it, and Script B re-checks at drain time.
3. **`custom_field.name` is capped at 100 characters and must be unique.** Treat it as the stable
   question key — the App and `questionMap` both match on it. Long prompts go in `description`
   (≤1000), which renders as helper text.
4. **A submitted value for `single`/`multi`/`users` must already exist in the option list**, or the
   write is rejected with `errors.not_found` and *nothing is stored*. This is the most common silent
   failure in the custom-field API.

Also: a field with a missing or dangling `custom_field_section_id` vanishes everywhere, because the
query INNER JOINs the section. And a `field_type` outside the six supported values is silently
dropped with no error and no log.

### 3.3 Asset-driven conditionality

Use `custom_field_rule` for this and only this. A rule's antecedent is a value stored **on the
asset**, so it expresses *"ask question B on this asset only when attribute A of this asset is X"* —
for example, show the detailed-justification questions only when *Access Request Tier* is `in`
`Tier 2…, Tier 3…`.

`/api/custom_field_value` resolves these server-side, so by the time the question set reaches the App
they are already applied. Nothing to build.

Respondent-driven branching — *"you answered Yes, so now answer these three"* — cannot be expressed
this way, because the antecedent is an answer in flight rather than a value on the asset. It goes in
`questionMap` instead.

---

## 4. Create the App Entities

App → Entities tab. `auth`, `access`, `user` and `group` are reserved names.

| Name | Type | Settings |
|---|---|---|
| `resolveQuestions` | Custom Script | Points at Script A (§5.1). Pick a parameter set |
| `questionMap` | Dataset | Points at the questionMap Dataset (§4.2) |
| `requests` | Internal, **App Dataset**, `access_type='managed'` | Request headers |
| `answers` | Internal, **App Dataset**, `access_type='managed'` | Answer rows |
| `drafts` | Internal, **not** an App Dataset, `access_type='private'` | In-progress answers |

> `/data/page/{app}/entity` leaks entity configuration (`custom_script_id`, `dataset_id`, …) to any
> user with page access. Nothing sensitive should live in an entity name or id.

App Entity config is cached (`useCache`), so expect staleness for up to `API_QUERY_CACHE_LIFETIME`
after changing an entity. `?isEditMode=Y` bypasses page caching while developing.

### 4.1 The two App Datasets

App Datasets auto-extend their schema on first insert, so you can let the App create the columns —
**except for the wide text columns**, which must be pre-sized.

**Why:** `AppDataset::checkAddColumns` assigns the new length before comparing it, so the
widen branch is dead code. A column takes its width from the first value written to it and never
grows. The default is 400 characters. A later, longer answer then fails the insert.

Pre-size these in the Dataset column editor (growing a column *there* does trigger a live DDL sync):

| Dataset | Column | Size |
|---|---|---|
| `answers` | `answer_value` | 4000 |
| `answers` | `title` | 255 |
| `answers` | `section` | 255 |
| `requests` | `element_name` | 500 |
| `requests` | `status` | 100 |

Columns the App writes:

- **`requests`** — `request_id` · `client_request_uid` · `element_id` · `segment_value_id` ·
  `element_name` · `requester_type` · `submitted_time` · `tier` · `domain` · `risk_classification` ·
  `approval_route` · `destination` · `destination_ref` · `status` · `notified_ind` · `expires_on`
- **`answers`** — `request_id` · `element_id` · `segment_value_id` · `user_id` · `username` ·
  `cf_id` · `cfs_id` · `section` · `title` · `answer_value` · `parent_cf_id` · `seq` ·
  `submitted_time`

MI adds `id` and `owner_user_id` to both. **`owner_user_id` is stamped server-side from the session,
never from request input** — that is what makes the ledger's attribution unforgeable, and it is why
the App never needs the Custom Script tier to be trusted with identity.

Two more things about App Datasets:

- **No primary key or unique constraint.** Idempotency is enforced upstream, via
  `client_request_uid`.
- **Do not expose DELETE.** A DELETE with neither `id` nor `where` reaches a delete-everything branch.

`answers` is one row per answer rather than a JSON blob because MI cannot query JSON inside a dataset
column: derived fields are restricted to a numeric-only function allow-list and dataset filters have
no JSON operators. Normalised rows are filterable, groupable, chartable and alertable.

### 4.2 The `questionMap` Dataset

A plain manual Dataset, admin-editable, carrying exactly what Custom Fields cannot express.

| Column | Purpose |
|---|---|
| `question_key` | Matches `custom_field.name`. The only required column |
| `field_type` | One of `single` `multi` `textarea` `email` `date` `users`. Overrides the App's inference |
| `required` | `Y` makes the question required |
| `applies_when_question_key` | Show this question only when that question is answered… |
| `applies_when_value` | …with any of these comma-separated values |
| `seq` | Overrides order within the step |
| `help_text` | Overrides `custom_field.description` |

Every column except `question_key` is optional. A question with no map row renders with inferred
defaults and no branching, so you only write the rows you need.

**Field type inference, when `field_type` is blank:** a question with an option list renders as
`single`; everything else renders as `textarea`. No REST endpoint exposes `custom_field.field_type`,
which is why the override column exists. `single` is the safe default of the two pick-list types —
rendering a `multi` as `single` collects one valid value, whereas the reverse collects a comma-joined
string MI would reject because the composite is not in the option list.

**Worked example.** *Records Retention Policy Compliance* is a `single` whose
`Custom (explicit stewardship review required)` option must reveal a justification question:

| question_key | field_type | required | applies_when_question_key | applies_when_value |
|---|---|---|---|---|
| `Records Retention Policy Compliance` | `single` | `Y` | | |
| `Retention Exception Justification` | `textarea` | `Y` | `Records Retention Policy Compliance` | `Custom (explicit stewardship review required)` |

Branches chain: a follow-up whose own antecedent is hidden stays hidden.

---

## 5. Install the Custom Scripts

### 5.1 Script A — `resolveQuestions`

Admin → Custom Scripts → New. Paste `custom-scripts/resolveQuestions.js`.

- **Service account: administrator.** `visible_to='groups'` is evaluated against whoever makes the
  call and admins bypass it entirely, so a non-admin service account would silently return a question
  set filtered by its *own* group membership.
- No parameters needed.
- Attach it to the `resolveQuestions` App Entity.

It makes two fast reads and no external calls, so the 30-second heartbeat watchdog is never in play.

**Test it** by opening `/data/page/access-request/resolveQuestions?req[element_id]=29` as a regular
user. You should get a `@@MIJSON@@…@@ENDJSON@@` blob. If you get nothing, check
`CUSTOM_SCRIPT_ENABLED` first.

### 5.2 Script B — `drainSubmissions`

Admin → Custom Scripts → New. Paste `custom-scripts/drainSubmissions.js`.

Parameters:

| Name | Type | Value |
|---|---|---|
| `portalUrl` | text | The approval portal's intake endpoint |
| `portalToken` | **password** | Bearer token — encrypted at rest, masked in the run log |
| `batchLimit` | text | Rows per run. Default 25 |
| `dryRun` | text | `Y` logs payloads and writes nothing. **Start here** |

Then attach it to a **Notification Schedule** (`notification_schedule_custom_script`). Every ~10
minutes is the realistic MVP cadence — MI has no instant-notification primitive.

Do **not** wire this to a button. It must stay scheduled: a 35-second portal call would be truncated
by the heartbeat watchdog and return a partial body with HTTP 200, and every Custom Script shares one
headless Chromium with the email digest, chart export and Concierge screenshots.

> Note `custom_script_parameter_set_id` is a **sort preference, not a filter** — a stale id silently
> falls back to the default set.
>
> Note also that the image-generator container logs the full POST body on every run, so the token
> appears in that container's log. Plan for redaction or accept it as a documented risk.

---

## 6. Notification

Native path: **Report Alert Rule → alert-gated Burst tile → trigger-driven Notification Schedule**,
over the `requests` dataset.

Two constraints to design around:

- **Burst recipients must be MI users.** To email a shared mailbox, create an MI user whose email
  *is* that mailbox. (The exception is `access_request_email` on an element or category, which takes
  free text and feeds MI's own access-request digest.)
- **Burst dedupe is element-level, not row-level.** That is what the `notified_ind` column is for —
  Script B flips it to `Y`, and the alert rule filters on it.

MI's own access-request digest fires on `user_access_request_log`, which the App writes to as well —
so a request is notified twice unless you set `SEND_ACCESS_REQUEST_DIGEST=N`. Be aware that requests
filed while it is off are permanently skipped once it is re-enabled.

---

## 7. Persona without asking

The App pre-fills *Requester Type* from `auth/info`, which returns the caller's MI Groups (with their
`ldap_organizational_unit`) and their user Custom Attributes. Make the persona expressible as one of:

1. **MI Group membership**, synced from the directory — `mi-ldap-usersync --map-attr-to-group
   eduPersonAffiliation`, the Okta/O365 equivalents, `SAML_GROUP_FIELD` on every login, or
   `mi-dataset-usersync` driven from a Dataset you load yourself.
2. **A user Custom Attribute** — create a `custom_attribute` with `used_for_user_ind='Y'` and
   `external_id='eduPersonAffiliation'`. Any matching SAML assertion attribute then self-populates on
   every login, persisted and queryable. Values are sync-only and read-only in the UI.

The App matches the session's groups and attributes against the *Requester Type* option list, exactly
and then by containment, and only ever selects an option that is actually on the list. If nothing
matches it leaves the question blank rather than guessing.

The user confirms rather than self-declares. That satisfies "infer, don't ask" while keeping the value
on the audit record where a steward needs it.

> Custom **Fields** cannot attach to a user (`item_type` is element / dataset / glossary only) —
> Custom **Attributes** are the user-level mechanism.

---

## 8. Verifying the API contract by hand

Worth doing once before wiring anything up. `element_info` and `custom_field_value` disagree about
where the id goes, and that disagreement is the usual source of a 405.

```bash
# ✅ correct
curl -i 'https://beta7.metricinsights.com/api/element_info?element=29&with_custom_fields=Y&with_glossary_terms=Y' -H 'Token: …'

# ✅ correct
curl -i 'https://beta7.metricinsights.com/api/custom_field_value?element=29' -H 'Token: …'

# ❌ 405 — the `id` param flips dispatch to getAction, which is not implemented
curl -i 'https://beta7.metricinsights.com/api/element_info?id=29' -H 'Token: …'
```

**One-line triage:** run `curl -i`. **No `Allow:` header and `Content-Type: application/json` means
an MI application 405 — a wrong URL/verb combination.** An `Allow:` header means the verb has no
route at all (Laravel), or the URL missed the case-sensitive `/api` prefix (Apache).

The 405s are never the firewall. There are no HTTP-method restrictions anywhere in the web
container's Apache config, and the OWASP CRS ruleset — which contains the method-enforcement rules —
is deleted at image build time.

Two other useful calls: `POST /data/api/get-sample` with `item=<entity>&id=<n>` returns the exact
parameter string an entity expects, and `GET /api/token` reports token status even when the token is
dead.

**Auth, precisely.** `application_id` + `application_key` are *not* accepted on data endpoints — they
are the credential you exchange at `/api/get_token`. For an App on the MI origin, use the session
cookie and nothing else, which is what this App does.

---

## 9. Build order

| Phase | Deliverable |
|---|---|
| 1 | §0 prerequisites, §2 native discoverability on a pilot category |
| 2 | §3.1 policy custom fields on ~10 pilot assets |
| 3 | §3.2 question custom fields, sections, option lists, §3.3 asset-driven rules |
| 4 | §8 — prove the API contract by hand |
| 5 | §1 App deployed, Git-synced; asset detail and questionnaire run against a stubbed question set |
| 6 | §5.1 Script A + its App Entity; the questionnaire goes live |
| 7 | §4.2 `questionMap` Dataset |
| 8 | §4.1 the two App Datasets; submit writes answer rows and files the native request |
| 9 | §2 launch links on the pilot Category's Access Denied Message |
| 10 | §6 Report Alert Rule + Burst to a group mailbox |
| 11 | §5.2 Script B on a Notification Schedule |
| 12 | Status callback receiver, so the portal's webhook keeps `status` current |
| 13 | Collibra Data Source → Dataset → Metadata Propagation rule; retire manual tier entry |

Phases 1–10 deliver a working, audited, governed request flow with **no external system, no MI code
change and no patch**. Phases 3, 7 and 12 are the config-only surface that can be handed to a
non-developer team: the question bank, the branching rules and the classification feed are all data.
