/* eslint-disable */
/**
 * Custom Script A — resolveQuestions
 * =================================
 *
 * Returns the question set that applies to one asset, for a requester who
 * cannot see that asset.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * `GET /api/custom_field_value?element={id}` is the only endpoint that applies
 * both the `used_for_*` scoping and `checkVisibility()` — so its output is
 * exactly the questions that currently apply to that asset, with the
 * asset-driven `custom_field_rule` conditions already resolved server-side.
 * But it requires `isPermitted` on the element, which a blocked requester by
 * definition lacks. The two alternatives both fail: `/api/custom_field`
 * returns definitions with no `used_for_*`, no rules and no visibility
 * metadata, and `element_info`'s `access_request_info` payload applies
 * empty-value suppression, which silently drops every unanswered question.
 *
 * So this script calls that endpoint as its own service account, and the App
 * calls this script.
 *
 * WHAT IT JOINS, AND WHY
 * ----------------------
 * Neither endpoint alone is enough, so it reads both and joins on `cf_id`:
 *
 *   /api/custom_field_value?element=N  →  WHICH questions apply, in authored
 *                                          order, plus each field's stored
 *                                          value on this element
 *   /api/custom_field                  →  help text and option lists
 *
 * Authored order matters and comes for free: `getFieldsArray` iterates the
 * section set in `custom_field_section.seq` order and each section's fields in
 * their own `seq` order, so a field's *position* in the response is its
 * authored position. This script preserves that and emits explicit
 * `section_seq` / `field_seq` indices, so the App never has to re-sort.
 *
 * WHAT IT CANNOT RETURN
 * ---------------------
 * `custom_field.field_type` is not exposed by any REST endpoint, and
 * `custom_field` has no `required_ind` at all. Both come from the
 * `questionMap` Dataset instead, which keeps them admin-editable. This script
 * reports whether a field has an option list, which is enough for the App to
 * infer pick-list versus free text, and the map overrides the rest.
 *
 * SERVICE ACCOUNT
 * ---------------
 * Must be an administrator. `visible_to='groups'` on a custom field is
 * evaluated against whoever makes the call and admins bypass it entirely, so a
 * non-admin service account would silently return a question set filtered by
 * its own group membership rather than the full one. Set every *question*
 * field to `visible_to='all'` regardless — persona is captured as a pre-filled
 * answer, not as a visibility gate.
 *
 * RUNTIME NOTES
 * -------------
 * This is not Node. MI renders the script inside a headless Chromium with
 * jQuery 3.7.1 and underscore inlined, and `customScript.*` as the SDK. Two
 * consequences shape the code below:
 *
 *   - The runner closes a run if 30 seconds pass since the last *successful*
 *     MI API call, so the nominal one-hour timeout is not the real ceiling.
 *     This script makes two fast reads and no external calls, so the watchdog
 *     is never in play.
 *   - Output is the `innerHTML` of one div, echoed back raw. The payload is
 *     therefore base64-encoded inside a sentinel: base64's alphabet contains
 *     no character `innerHTML` escapes, and the sentinel lets the App find the
 *     payload among any log lines, because `cs.log` writes to the same div.
 *
 * INSTALL
 * -------
 * Paste this file into Admin → Custom Scripts as the script body, then point
 * the `resolveQuestions` App Entity at it. See docs/MI-SETUP.md §4.
 */

(function () {
  'use strict';

  var cs = customScript;

  /** Sentinel the App looks for. Keep in sync with `src/api/page-api.ts`. */
  var RESULT_PREFIX = '@@MIJSON@@';
  var RESULT_SUFFIX = '@@ENDJSON@@';

  /** Hard stop, well inside the 30-second heartbeat window. */
  var SCRIPT_TIMEOUT_MS = 20000;

  var finished = false;

  function homeUrl(path) {
    return cs.homeSite.replace(/\/?$/, '/') + String(path).replace(/^\//, '');
  }

  /** base64 of a UTF-8 string, chunked so a large set cannot blow the stack. */
  function encodePayload(text) {
    var utf8 = unescape(encodeURIComponent(text));
    var binary = '';
    for (var i = 0; i < utf8.length; i += 8192) {
      binary += utf8.slice(i, i + 8192);
    }
    return btoa(binary);
  }

  function emit(payload) {
    if (finished) return;
    finished = true;

    cs.result(RESULT_PREFIX + encodePayload(JSON.stringify(payload)) + RESULT_SUFFIX);

    // Give MI a beat to flush the output div before the page is torn down.
    setTimeout(function () {
      cs.close();
    }, 500);
  }

  function fail(message, elementId, segmentValueId) {
    // Emit a well-formed payload even on failure: the App can then show the
    // reason in place of the questionnaire rather than a parse error.
    emit({
      element_id: elementId || 0,
      segment_value_id: segmentValueId || 0,
      questions: [],
      warnings: [String(message)],
    });
  }

  function get(path) {
    return new Promise(function (resolve, reject) {
      cs.runApiRequest(homeUrl(path), {
        type: 'GET',
        success: function (data) {
          resolve(data);
        },
        error: function (xhr, status, error) {
          reject(new Error(path + ' → ' + (xhr && xhr.status ? xhr.status + ' ' : '') + (error || status)));
        },
      });
    });
  }

  /* ---------------------------------------------------------------- main - */

  // `req` is injected as a global by `PageDataController`, JSON-encoded with
  // JSON_FORCE_OBJECT, so it is always an object when present.
  var input = typeof req === 'object' && req ? req : {};
  var elementId = parseInt(input.element_id, 10) || 0;
  var segmentValueId = parseInt(input.segment_value_id, 10) || 0;

  var watchdog = setTimeout(function () {
    fail('The question set took too long to resolve.', elementId, segmentValueId);
  }, SCRIPT_TIMEOUT_MS);

  if (!elementId) {
    clearTimeout(watchdog);
    fail('No element_id was supplied to resolveQuestions.', 0, 0);
    return;
  }

  Promise.all([
    // The applicable set. `?element=` is promoted to the route id by the
    // controller's `init()`; `?id=` would dispatch to `getAction` and 405.
    get('api/custom_field_value?element=' + elementId),
    // Definitions: help text, and the option list for pick lists.
    get('api/custom_field'),
  ])
    .then(function (responses) {
      clearTimeout(watchdog);

      var applicable = (responses[0] && responses[0].custom_field_values) || [];
      var definitions = (responses[1] && responses[1].custom_fields) || [];

      var byId = {};
      for (var i = 0; i < definitions.length; i++) {
        var definition = definitions[i];
        byId[String(definition.cf_id)] = definition;
      }

      var warnings = [];
      var sectionOrder = {};
      var sectionCount = 0;
      var fieldSeq = {};
      var questions = [];

      for (var j = 0; j < applicable.length; j++) {
        var field = applicable[j];
        var sectionKey = String(field.cfs_id);

        // First appearance order *is* authored order — see the header note.
        if (!(sectionKey in sectionOrder)) {
          sectionOrder[sectionKey] = sectionCount++;
          fieldSeq[sectionKey] = 0;
        }

        var definitionForField = byId[String(field.cf_id)];
        if (!definitionForField) {
          // The two endpoints disagree, which normally means the field was
          // edited between the calls. Keep the question, lose the help text.
          warnings.push('No definition found for "' + field.title + '" — its help text and options are missing.');
        }

        var options = null;
        if (definitionForField && definitionForField.values && definitionForField.values.length) {
          options = [];
          for (var k = 0; k < definitionForField.values.length; k++) {
            var option = definitionForField.values[k];
            // `getAvailableValues` returns either bare strings or objects
            // carrying `value`, depending on the value provider.
            var text = option && typeof option === 'object' ? option.value : option;
            if (text !== undefined && text !== null && String(text) !== '') options.push(String(text));
          }
        }

        questions.push({
          cf_id: parseInt(field.cf_id, 10) || 0,
          cfs_id: parseInt(field.cfs_id, 10) || 0,
          section: field.section || '',
          title: field.title || '',
          description: definitionForField ? definitionForField.description || '' : '',
          options: options,
          section_seq: sectionOrder[sectionKey],
          field_seq: fieldSeq[sectionKey]++,
          // Present for policy fields, empty for question fields — a question
          // field's element-level value is irrelevant by design.
          value: field.value === undefined ? null : field.value,
        });
      }

      if (questions.length === 0) {
        warnings.push(
          'No custom fields apply to this asset. Check that the question fields are enabled, ' +
            'have a valid section, and have the used_for_* flag set for this asset type.',
        );
      }

      emit({
        element_id: elementId,
        segment_value_id: segmentValueId,
        questions: questions,
        warnings: warnings,
      });
    })
    .catch(function (error) {
      clearTimeout(watchdog);
      cs.error('resolveQuestions failed: ' + (error && error.message ? error.message : error));
      fail(
        'Could not read the question set: ' + (error && error.message ? error.message : error),
        elementId,
        segmentValueId,
      );
    });
})();
