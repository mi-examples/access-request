/* eslint-disable */
/**
 * Custom Script B — drainSubmissions
 * ==================================
 *
 * Forwards submitted requests to the organisation's approval portal, then
 * writes the portal's reference back onto the MI request row.
 *
 * THIS IS SCHEDULED, NOT INTERACTIVE
 * ----------------------------------
 * Run it from a Notification Schedule. It must never be wired to a button.
 * Three properties of the Custom Script runner make a synchronous outbound
 * call unsafe:
 *
 *   - A 30-second heartbeat watchdog closes a run if that long passes since
 *     the last *successful* MI API call. An approval-portal call that takes 35
 *     seconds is truncated, and the caller gets a partial body with HTTP 200.
 *   - There is no concurrency cap. Every Custom Script shares one Chromium, so
 *     N simultaneous submissions are N tabs in one browser, each pinning a PHP
 *     worker.
 *   - That same renderer produces email digests, chart and report image
 *     exports, and Concierge screenshots. Exhausting its memory takes all of
 *     them down with it.
 *
 * So the App returns to the requester the moment their answers are written,
 * and this drains the queue out of band. That is also why an external portal
 * is the destination rather than an Access Request Profile: a profile's placeholder
 * vocabulary is a fixed list with no extension point, any unrecognised token
 * is left literal in the body producing invalid JSON at the provider, and it
 * processes only the first tile. A profile can say *user X wants element Y*;
 * it structurally cannot carry a questionnaire. This script owns the outbound
 * call permanently, not as a stopgap.
 *
 * IDENTITY
 * --------
 * This script is never trusted with identity, and never needs to be. It reads
 * `owner_user_id` off rows MI already stamped server-side from the session at
 * insert time. Nothing in a request payload is taken on trust.
 *
 * DRAIN-TIME VALIDATION
 * ---------------------
 * Submit-time server-side validation is not possible inside the App's own
 * request, so it happens here instead. Holding an admin token, this script can
 * re-derive the asset's applicable question set and check the submitted
 * answers against it before creating a ticket. Deferring is safe because
 * nothing is provisioned until the request is approved.
 *
 * PARAMETERS (Admin → Custom Scripts → Parameters)
 * ------------------------------------------------
 *   portalUrl        text      Approval-portal intake endpoint (https).
 *   portalToken      password  Bearer token. Encrypted at rest and masked as
 *                              ******** in `custom_script_run_log.parameters`.
 *   batchLimit       text      Rows per run. Default 25.
 *   dryRun           text      'Y' logs the payloads and writes nothing.
 *
 * Confirm `CONST_PHP_PASSWORDS_ENCRYPTED` and `ENCRYPT_PASSWORDS` are both on,
 * or the token is stored in plaintext. Note also that the image-generator
 * container logs the full POST body on every run, so the token appears in that
 * container's log regardless — plan for redaction or accept it as a documented
 * risk.
 *
 * INSTALL
 * -------
 * Paste into Admin → Custom Scripts, add the parameters above, then attach it
 * to a Notification Schedule. See docs/MI-SETUP.md §5.
 */

(function () {
  'use strict';

  var cs = customScript;
  var params = cs.parameters || {};

  /** Must match `APP_SLUG` in `src/config.ts`. */
  var APP_SLUG = 'access-request';

  /**
   * Must match `REQUEST_STATUS` in `src/config.ts`. Placeholders — set both to
   * the destination portal's own status strings.
   */
  var STATUS_PENDING = 'PENDING SUBMISSION';
  var STATUS_SUBMITTED = 'SUBMITTED';
  var STATUS_FAILED = 'SUBMISSION FAILED';

  var RESULT_PREFIX = '@@MIJSON@@';
  var RESULT_SUFFIX = '@@ENDJSON@@';

  var BATCH_LIMIT = parseInt(params.batchLimit, 10) > 0 ? parseInt(params.batchLimit, 10) : 25;
  var DRY_RUN = String(params.dryRun || 'N').toUpperCase() === 'Y';
  var PORTAL_URL = String(params.portalUrl || '');
  var PORTAL_TOKEN = String(params.portalToken || '');

  /**
   * Ceiling for the whole run. The nominal script timeout is an hour, but the
   * heartbeat watchdog is the real constraint — every MI call below refreshes
   * it, and each portal call is bounded separately.
   */
  var RUN_TIMEOUT_MS = 15 * 60 * 1000;
  var PORTAL_TIMEOUT_MS = 20000;

  var finished = false;
  var summary = { examined: 0, submitted: 0, failed: 0, skipped: 0, messages: [] };

  function homeUrl(path) {
    return cs.homeSite.replace(/\/?$/, '/') + String(path).replace(/^\//, '');
  }

  function encodePayload(text) {
    var utf8 = unescape(encodeURIComponent(text));
    var binary = '';
    for (var i = 0; i < utf8.length; i += 8192) binary += utf8.slice(i, i + 8192);
    return btoa(binary);
  }

  function finish() {
    if (finished) return;
    finished = true;

    cs.log(
      'drainSubmissions: examined ' +
        summary.examined +
        ', submitted ' +
        summary.submitted +
        ', failed ' +
        summary.failed +
        ', skipped ' +
        summary.skipped,
    );

    cs.result(RESULT_PREFIX + encodePayload(JSON.stringify(summary)) + RESULT_SUFFIX);
    setTimeout(function () {
      cs.close();
    }, 500);
  }

  /**
   * An MI call.
   *
   * `runApiRequest` injects the script's API token, and MI's `InitSession`
   * middleware honours that token on `/data/page/*` as well as `/api/*` — so
   * the App Entity endpoints are reachable from here, and the entity's own
   * access rules still apply. That is why this reads and writes the request
   * rows through the App's entities rather than through
   * `PUT /api/dataset_data`, which rewrites the entire dataset in PHP memory
   * and would lose concurrent submissions.
   */
  function miRequest(path, settings) {
    return new Promise(function (resolve, reject) {
      cs.runApiRequest(
        homeUrl(path),
        Object.assign({ type: 'GET' }, settings || {}, {
          success: function (data) {
            resolve(data);
          },
          error: function (xhr, status, error) {
            reject(new Error(path + ' → ' + (xhr && xhr.status ? xhr.status + ' ' : '') + (error || status)));
          },
        }),
      );
    });
  }

  /**
   * A call to the approval portal.
   *
   * CORS does not apply: the Custom Script browser is launched with
   * `--disable-web-security`, so a script can POST to any external HTTPS API
   * and read the response regardless of its CORS headers. `$.ajax` is used
   * directly rather than `runApiRequest`, which would attach MI's own token to
   * a third-party request.
   */
  function portalRequest(payload) {
    return new Promise(function (resolve, reject) {
      var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (PORTAL_TOKEN) headers.Authorization = 'Bearer ' + PORTAL_TOKEN;

      $.ajax({
        url: PORTAL_URL,
        type: 'POST',
        timeout: PORTAL_TIMEOUT_MS,
        headers: headers,
        // A JSON body, not query parameters: it avoids URL-length and encoding
        // traps that the older portal-page integration pattern ran into.
        data: JSON.stringify(payload),
        dataType: 'json',
      })
        .done(function (data) {
          // Refresh the heartbeat by hand — the watchdog only counts
          // successful *MI* calls, and a slow portal is exactly the case that
          // would otherwise truncate the run.
          cs.updateHeartBeat();
          resolve(data);
        })
        .fail(function (xhr, status, error) {
          cs.updateHeartBeat();
          reject(new Error('portal → ' + (xhr && xhr.status ? xhr.status + ' ' : '') + (error || status)));
        });
    });
  }

  /* ------------------------------------------------------------ pipeline - */

  function loadPendingRequests() {
    return miRequest(
      'data/page/' +
        APP_SLUG +
        '/requests?filters[status]=' +
        encodeURIComponent(STATUS_PENDING) +
        '&limit=' +
        BATCH_LIMIT,
    ).then(function (response) {
      return (response && response.data) || [];
    });
  }

  function loadAnswers(requestId) {
    return miRequest(
      'data/page/' + APP_SLUG + '/answers?filters[request_id]=' + encodeURIComponent(requestId) + '&limit=500',
    ).then(function (response) {
      return (response && response.data) || [];
    });
  }

  /** The submitter, resolved from the id MI stamped — never from the payload. */
  function loadSubmitter(ownerUserId) {
    if (!ownerUserId) return Promise.resolve(null);

    return miRequest('api/user?id=' + encodeURIComponent(ownerUserId))
      .then(function (response) {
        var users = (response && (response.users || response.user)) || null;
        if (!users) return null;
        return users.length ? users[0] : users;
      })
      .catch(function () {
        // `/api/user` is admin-only. A non-admin service account still drains,
        // it just cannot enrich the payload with the submitter's details.
        summary.messages.push('Could not read the submitter — is the service account an administrator?');
        return null;
      });
  }

  /**
   * Re-derive the asset's applicable question set and flag answers that are
   * no longer part of it.
   *
   * Not fatal: a question retired between submission and drain should be
   * recorded as context, not used to reject a request the requester already
   * completed in good faith.
   */
  function validateAnswers(elementId, answers) {
    return miRequest('api/custom_field_value?element=' + elementId)
      .then(function (response) {
        var applicable = (response && response.custom_field_values) || [];
        var valid = {};
        for (var i = 0; i < applicable.length; i++) valid[String(applicable[i].cf_id)] = true;

        var unexpected = [];
        for (var j = 0; j < answers.length; j++) {
          if (!valid[String(answers[j].cf_id)]) unexpected.push(answers[j].title);
        }

        return unexpected;
      })
      .catch(function (error) {
        summary.messages.push('Could not re-validate answers for element ' + elementId + ': ' + error.message);
        return [];
      });
  }

  function buildPayload(row, answers, submitter, unexpected) {
    var byQuestion = [];
    for (var i = 0; i < answers.length; i++) {
      byQuestion.push({
        section: answers[i].section,
        question: answers[i].title,
        answer: answers[i].answer_value,
        custom_field_id: answers[i].cf_id,
      });
    }

    return {
      // The idempotency key. Look it up before creating a ticket so a retried
      // drain cannot file the same request twice — MI's dataset tables carry
      // no unique constraint, so idempotency has to be enforced here.
      client_request_uid: row.client_request_uid,
      request_id: row.request_id,
      submitted_at: row.submitted_time,

      requester: {
        // Templated identity under one service account: the portal must accept
        // these fields as the requester rather than expecting the end user's
        // own SSO session.
        user_id: row.owner_user_id,
        username: submitter ? submitter.username : '',
        display_name: submitter ? submitter.display_name : '',
        email: submitter ? submitter.email : '',
        requester_type: row.requester_type,
      },

      asset: {
        element_id: row.element_id,
        segment_value_id: row.segment_value_id,
        name: row.element_name,
        domain: row.domain,
        risk_classification: row.risk_classification,
        tier: row.tier,
      },

      routing: {
        // Selects between the portal's intake paths (general intake, API
        // access, escalated review, …). Confirm which field the portal keys
        // request type off before relying on this name.
        approval_route: row.approval_route,
        it_assessment_required: /tier\s*3/i.test(String(row.tier || '')) ? 'Y' : 'N',
      },

      answers: byQuestion,
      validation_warnings: unexpected.length
        ? ['Answers no longer in the asset question set: ' + unexpected.join(', ')]
        : [],
    };
  }

  /** Pulls the portal's ticket id out of whatever shape it answers with. */
  function extractReference(response) {
    if (!response) return '';
    var candidates = ['request_id', 'requestId', 'number', 'ticket', 'id', 'reference'];
    for (var i = 0; i < candidates.length; i++) {
      if (response[candidates[i]]) return String(response[candidates[i]]);
    }
    if (response.result && response.result.number) return String(response.result.number);
    return '';
  }

  function markRow(row, patch) {
    return miRequest('data/page/' + APP_SLUG + '/requests?id=' + encodeURIComponent(row.id), {
      type: 'PUT',
      data: JSON.stringify({ data: patch }),
    });
  }

  function processRow(row) {
    summary.examined++;

    if (!row.id) {
      summary.skipped++;
      summary.messages.push('Request ' + row.request_id + ' has no row id; cannot be updated.');
      return Promise.resolve();
    }

    return loadAnswers(row.request_id)
      .then(function (answers) {
        return Promise.all([answers, loadSubmitter(row.owner_user_id), validateAnswers(row.element_id, answers)]);
      })
      .then(function (parts) {
        var payload = buildPayload(row, parts[0], parts[1], parts[2]);

        if (DRY_RUN) {
          summary.skipped++;
          cs.log('DRY RUN — would submit ' + row.request_id + ': ' + JSON.stringify(payload).slice(0, 800));
          return null;
        }

        if (!PORTAL_URL) {
          throw new Error('portalUrl parameter is not set.');
        }

        return portalRequest(payload);
      })
      .then(function (response) {
        if (response === null) return null;

        var reference = extractReference(response);
        summary.submitted++;

        return markRow(row, {
          destination_ref: reference,
          status: STATUS_SUBMITTED,
          // Per-row notification dedupe: MI's own Burst dedupe is
          // element-level, so this column is what makes "notify once per
          // request" possible.
          notified_ind: 'Y',
        });
      })
      .catch(function (error) {
        summary.failed++;
        summary.messages.push(row.request_id + ': ' + error.message);
        cs.error('drainSubmissions: ' + row.request_id + ' — ' + error.message);

        return markRow(row, { status: STATUS_FAILED }).catch(function () {
          // If even the status write fails the row stays pending and the next
          // run retries it, which is the safe direction.
        });
      });
  }

  /** Rows are processed one at a time — see the concurrency note in the header. */
  function processSequentially(rows) {
    return rows.reduce(function (chain, row) {
      return chain.then(function () {
        return processRow(row);
      });
    }, Promise.resolve());
  }

  /* ---------------------------------------------------------------- main - */

  var watchdog = setTimeout(function () {
    summary.messages.push('Run timed out; remaining rows stay pending for the next run.');
    finish();
  }, RUN_TIMEOUT_MS);

  loadPendingRequests()
    .then(function (rows) {
      cs.log('drainSubmissions: ' + rows.length + ' pending request(s)');
      return processSequentially(rows);
    })
    .then(function () {
      clearTimeout(watchdog);
      finish();
    })
    .catch(function (error) {
      clearTimeout(watchdog);
      summary.messages.push('Fatal: ' + (error && error.message ? error.message : error));
      cs.error('drainSubmissions failed: ' + (error && error.message ? error.message : error));
      finish();
    });
})();
