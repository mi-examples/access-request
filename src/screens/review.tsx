import { useMemo, useState } from 'react';
import { useAssetDetail, useQuestionMap, useQuestions, useSession } from '../api/queries';
import { applyQuestionMap, buildSteps, indexQuestionMap, visibleSteps } from '../domain/question-map';
import { validateAll } from '../domain/validation';
import { readAssetPolicy } from '../domain/policy';
import { serialiseAnswer, submitRequest } from '../domain/submission';
import { ErrorNotice, LoadingBlock, Notice, TierBadge } from '../components/primitives';
import { useDraftStore } from '../state/draft-context';
import type { Route } from '../state/router';

/**
 * Review every answer before submitting.
 *
 * Non-negotiable for an auditable trail, and the only place a multi-step
 * submission can be sanity-checked as a whole: a requester who has been
 * through several branching steps has no other view of what they are about to
 * put their name to.
 *
 * This is also where required-ness is enforced across the whole request rather
 * than a step at a time — `custom_field` has no `required_ind`, so the App is
 * the only enforcement point inside the request. Custom Script B re-checks at
 * drain time with an admin token, which is safe because nothing is provisioned
 * until the request is approved.
 */
export function ReviewScreen({
  elementId,
  segmentValueId,
  navigate,
}: {
  elementId: number;
  segmentValueId: number;
  navigate: (route: Route) => void;
}) {
  const session = useSession();
  const questions = useQuestions(elementId, segmentValueId);
  const questionMap = useQuestionMap();
  const detail = useAssetDetail(elementId, segmentValueId);
  const draft = useDraftStore();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const answers = draft.answersFor(elementId);

  const steps = useMemo(() => {
    if (!questions.data) {
      return [];
    }

    const mapped = applyQuestionMap(questions.data.questions, indexQuestionMap(questionMap.data ?? []));

    return visibleSteps(buildSteps(mapped), answers);
  }, [questions.data, questionMap.data, answers]);

  const policy = useMemo(() => readAssetPolicy(detail.data?.accessData || undefined), [detail.data]);
  const errors = useMemo(() => validateAll(steps, answers), [steps, answers]);

  const loading = questions.isLoading || questionMap.isLoading || detail.isLoading || session.isLoading;
  const loadError = questions.error ?? questionMap.error ?? detail.error ?? session.error;

  if (loading) {
    return <LoadingBlock label="Loading your answers" rows={6} />;
  }

  if (loadError) {
    return <ErrorNotice error={loadError} context="Could not load your answers" />;
  }

  // `accessData` is `false` when the element has no discoverable row.
  const accessData = detail.data?.accessData || undefined;
  const name = String(accessData?.element_dashboard_name ?? detail.data?.name ?? `Element ${elementId}`);
  const errorCount = Object.keys(errors).length;

  const rows = steps.flatMap((step) =>
    step.questions.map((question) => ({
      section: step.section,
      title: question.title,
      value: serialiseAnswer(answers[question.title]),
      error: errors[question.title],
    })),
  );

  const submit = async () => {
    if (!session.data) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitRequest({
        identity: session.data,
        subject: { element_id: elementId, segment_value_id: segmentValueId, name },
        steps,
        answers,
        policy,
      });

      // The draft has served its purpose; the ledger is now the record.
      draft.clearAnswers(elementId);
      navigate({ name: 'outcome', requestId: result.request_id });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="stack" style={{ gap: 4 }}>
          <h2>Review your request</h2>
          <p className="muted small">
            Check every answer. Once submitted, your answers are recorded against your Metric Insights account and sent
            to the approval process.
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => navigate({ name: 'questionnaire', elementId, segmentValueId })}
        >
          ← Back to questions
        </button>
      </div>

      <section className="card card--flush">
        <div className="card__header">
          <div className="stack" style={{ gap: 2 }}>
            <h3>{name}</h3>
            <div className="row">
              <TierBadge tier={policy.tier} />
              {policy.approvalRoute ? <span className="muted small">Route: {policy.approvalRoute}</span> : null}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card__body">
            <p className="muted">No questions apply to this asset.</p>
          </div>
        ) : (
          <table className="table">
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.section}:${row.title}`}>
                  <th scope="row" style={{ width: '38%' }}>
                    <div>{row.title}</div>
                    <div className="muted small" style={{ fontWeight: 400 }}>
                      {row.section}
                    </div>
                  </th>
                  <td>
                    {row.error ? (
                      <span className="field__error">{row.error}</span>
                    ) : (
                      <span style={{ whiteSpace: 'pre-line' }}>{row.value || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {errorCount > 0 ? (
        <Notice tone="error" title={`${errorCount} answer${errorCount === 1 ? '' : 's'} still needed`}>
          Go back to the questions and complete the ones highlighted above.
        </Notice>
      ) : null}

      {submitError ? <ErrorNotice error={submitError} context="Your request was not submitted" /> : null}

      <div className="row row--between">
        <span className="muted small">
          {policy.targetTurnaround ? `Typical turnaround: ${policy.targetTurnaround}.` : null}
        </span>
        <button
          type="button"
          className="button button--primary"
          disabled={errorCount > 0 || submitting || !session.data}
          onClick={submit}
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </div>
  );
}
