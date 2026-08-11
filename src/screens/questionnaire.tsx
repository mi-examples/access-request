import { useEffect, useMemo, useState } from 'react';
import { useAssetDetail, useQuestionMap, useQuestions, useSession } from '../api/queries';
import { applyQuestionMap, buildSteps, indexQuestionMap, normaliseKey, visibleSteps } from '../domain/question-map';
import { prefillAnswers } from '../domain/persona';
import { validateStep, type FieldErrors } from '../domain/validation';
import { readAssetPolicy } from '../domain/policy';
import { CONTACT_QUESTION, REQUESTER_TYPE_QUESTION } from '../config';
import { QuestionField } from '../components/question-field';
import { EmptyState, ErrorNotice, LoadingBlock, Notice, TierBadge } from '../components/primitives';
import { useDraftStore } from '../state/draft-context';
import type { Route } from '../state/router';

const PREFILLED = new Set([normaliseKey(CONTACT_QUESTION), normaliseKey(REQUESTER_TYPE_QUESTION)]);

/**
 * Screen 3 — the questionnaire.
 *
 * One step per `custom_field_section` that applies to this asset, in the
 * section's authored `seq` order. The question set arrives already filtered by
 * the asset-driven `custom_field_rule` conditions, because
 * `/api/custom_field_value` resolves them server-side; the App only evaluates
 * the respondent-driven branches from `questionMap`.
 *
 * Progress counts the steps remaining *for this request*, not the full
 * inventory. Sections a given requester never sees cost them nothing, which is
 * the whole point of asset-driven conditionality: the prototype's nineteen
 * steps were largely an artefact of asking every requester everything.
 */
export function QuestionnaireScreen({
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

  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);

  const answers = draft.answersFor(elementId);

  const allSteps = useMemo(() => {
    if (!questions.data) {
      return [];
    }

    const mapped = applyQuestionMap(questions.data.questions, indexQuestionMap(questionMap.data ?? []));

    return buildSteps(mapped);
  }, [questions.data, questionMap.data]);

  const steps = useMemo(() => visibleSteps(allSteps, answers), [allSteps, answers]);

  // Seed the questions the session can answer on the requester's behalf, once
  // the set is known and only where nothing is already recorded.
  useEffect(() => {
    if (!session.data || allSteps.length === 0) {
      return;
    }

    const flat = allSteps.flatMap((step) => step.questions);
    const seeded = prefillAnswers(flat, session.data, answers);

    if (Object.keys(seeded).length > 0) {
      draft.mergeAnswers(elementId, seeded);
    }
    // `answers` is intentionally excluded: re-running on every keystroke would
    // fight the user, and `prefillAnswers` only ever fills blanks anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data, allSteps, elementId]);

  // A branch closing can shorten the wizard out from under the current step,
  // so the active step is clamped on read rather than corrected afterwards —
  // there is no render in which `stepIndex` can point past the end.
  const activeIndex = steps.length > 0 ? Math.min(stepIndex, steps.length - 1) : 0;

  if (questions.isLoading || questionMap.isLoading || session.isLoading) {
    return <LoadingBlock label="Resolving the questions for this asset" rows={6} />;
  }

  if (questions.error) {
    return (
      <div className="stack">
        <ErrorNotice error={questions.error} context="Could not resolve the questions for this asset" />
        <Notice tone="warn" title="What to check">
          <ul>
            <li>
              <span className="mono">CUSTOM_SCRIPT_ENABLED</span> is <span className="mono">Y</span> on this instance.
            </li>
            <li>
              The <span className="mono">resolveQuestions</span> App Entity points at the Custom Script and has a
              parameter set selected.
            </li>
            <li>
              The script&apos;s service account is an administrator — the question set is filtered by whoever makes the
              call, and a non-admin service account silently drops group-scoped fields.
            </li>
          </ul>
        </Notice>
        <button type="button" className="button" onClick={() => questions.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="stack">
        <EmptyState title="No questions apply to this asset">
          <p className="muted">Nothing extra is needed. Add it to your request and submit.</p>
        </EmptyState>
        <div className="row">
          <button
            type="button"
            className="button"
            onClick={() => navigate({ name: 'asset', elementId, segmentValueId })}
          >
            Back to the asset
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate({ name: 'review', elementId, segmentValueId })}
          >
            Review and submit
          </button>
        </div>
      </div>
    );
  }

  const step = steps[activeIndex];
  const policy = readAssetPolicy(detail.data?.accessData || undefined);
  const isLast = activeIndex >= steps.length - 1;

  const goNext = () => {
    const stepErrors = validateStep(step, draft.answersFor(elementId));

    setErrors(stepErrors);

    if (Object.keys(stepErrors).length > 0) {
      setShowErrors(true);

      return;
    }

    setShowErrors(false);

    if (isLast) {
      navigate({ name: 'review', elementId, segmentValueId });

      return;
    }

    setStepIndex(activeIndex + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{detail.data?.accessData ? detail.data.accessData.element_dashboard_name : `Element ${elementId}`}</h2>
          <div className="row">
            <TierBadge tier={policy.tier} />
            {policy.targetTurnaround ? (
              <span className="muted small">Typical turnaround: {policy.targetTurnaround}</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => navigate({ name: 'asset', elementId, segmentValueId })}
        >
          Asset details
        </button>
      </div>

      {questions.data?.warnings?.length ? (
        <Notice tone="warn" title="The question set may be incomplete">
          <ul>
            {questions.data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {draft.saveError ? (
        <Notice tone="warn" title="Your progress is not being saved">
          <p className="small">Your answers are safe in this tab, but a refresh will lose them. {draft.saveError}</p>
        </Notice>
      ) : null}

      <div>
        <ol className="stepper">
          {steps.map((entry, index) => (
            <li
              key={entry.cfs_id}
              className="stepper__item"
              data-state={index === activeIndex ? 'current' : index < activeIndex ? 'done' : 'todo'}
            >
              <span aria-hidden="true">{index < activeIndex ? '✓' : index + 1}</span>
              {entry.section}
            </li>
          ))}
        </ol>
      </div>

      <section className="card">
        <h3 style={{ marginBottom: 16 }}>{step.section}</h3>

        <div className="stack">
          {step.questions.map((question) => (
            <QuestionField
              key={question.cf_id}
              question={question}
              value={answers[question.title]}
              error={showErrors ? errors[question.title] : undefined}
              prefilled={PREFILLED.has(normaliseKey(question.title))}
              onChange={(value) => draft.setAnswer(elementId, question.title, value)}
            />
          ))}
        </div>
      </section>

      <div className="row row--between">
        <button
          type="button"
          className="button"
          disabled={activeIndex === 0}
          onClick={() => setStepIndex(Math.max(0, activeIndex - 1))}
        >
          ← Back
        </button>

        <span className="muted small">
          Step {activeIndex + 1} of {steps.length}
        </span>

        <button type="button" className="button button--primary" onClick={goNext}>
          {isLast ? 'Review answers' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
