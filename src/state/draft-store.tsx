import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDraft, useSaveDraft, useSession } from '../api/queries';
import { miTimestamp } from '../domain/submission';
import { DraftContext, type DraftContextValue } from './draft-context';
import type { AnswerMap, DraftPayload } from '../types/app';

/**
 * In-progress questionnaire answers, persisted server-side.
 *
 * Persistence is not a nicety here. Any multi-step form that loses its state
 * on refresh does not get completed, and the questionnaire this replaces ran
 * to nineteen steps. The draft is written on every answer, debounced.
 *
 * It lives in the `drafts` entity — a plain internal entity with
 * `access_type='private'`, so MI filters reads and writes to `owner_user_id`.
 * That store is upsert-only with no history, which is exactly wrong for the
 * answer ledger and exactly right for scratch state.
 *
 * Answers are held per element rather than per session, so a requester who
 * starts one request, wanders back to the Metric Insights catalog and returns
 * for a different asset does not lose either. The in-memory copy is
 * authoritative for rendering and the server copy is a restore point, so a
 * failed save is surfaced but never blocks typing.
 */

const EMPTY_DRAFT: DraftPayload = { answers: {}, updated_at: '' };

/**
 * Shared empty answer map.
 *
 * `answersFor` is read inside `useMemo` dependency lists, so returning a fresh
 * `{}` for an untouched element would make every memo downstream recompute on
 * every render.
 */
const NO_ANSWERS: AnswerMap = Object.freeze({});

/** Debounce before writing, so typing does not spend the request budget. */
const SAVE_DEBOUNCE_MS = 1200;

export function DraftProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.data?.user_id;
  // One row per user. `access_type='private'` already scopes reads to the
  // owner, so the user id in the key is for legibility in the admin grid
  // rather than for isolation.
  const draftKey = userId ? `draft-${userId}` : '';

  const remote = useDraft(draftKey, Boolean(draftKey));
  const save = useSaveDraft(draftKey);

  const [draft, setDraft] = useState<DraftPayload>(EMPTY_DRAFT);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Hydrate once per user, from whatever the server has. A missing draft is
  // the normal first-visit case, not an error.
  //
  // Adjusting state during render rather than in an effect: this is derived
  // state that must be correct on the *first* paint, and an effect would
  // render the empty questionnaire once before replacing it.
  if (draftKey && !remote.isLoading && hydratedKey !== draftKey) {
    setHydratedKey(draftKey);
    setDraft(remote.data ? { ...EMPTY_DRAFT, ...remote.data } : EMPTY_DRAFT);
  }

  const hydrated = hydratedKey !== null && hydratedKey === draftKey;

  // `mutateAsync` is reference-stable across renders; the mutation object it
  // comes from is not, so depend on the function rather than the object.
  const { mutateAsync } = save;

  const persist = useCallback(
    (next: DraftPayload) => {
      if (!draftKey) {
        return;
      }

      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }

      saveTimer.current = window.setTimeout(() => {
        mutateAsync(next)
          .then(() => setSaveError(null))
          .catch((error: unknown) => {
            setSaveError(error instanceof Error ? error.message : String(error));
          });
      }, SAVE_DEBOUNCE_MS);
    },
    [draftKey, mutateAsync],
  );

  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  const update = useCallback(
    (mutate: (current: DraftPayload) => DraftPayload) => {
      setDraft((current) => {
        const next = { ...mutate(current), updated_at: miTimestamp() };

        persist(next);

        return next;
      });
    },
    [persist],
  );

  const value = useMemo<DraftContextValue>(
    () => ({
      ready: hydrated,
      saveError,

      answersFor: (elementId) => draft.answers[String(elementId)] ?? NO_ANSWERS,

      setAnswer: (elementId, question, answer) =>
        update((current) => {
          const key = String(elementId);

          return {
            ...current,
            answers: {
              ...current.answers,
              [key]: { ...(current.answers[key] ?? {}), [question]: answer },
            },
          };
        }),

      mergeAnswers: (elementId, answers) =>
        update((current) => {
          const key = String(elementId);

          return {
            ...current,
            answers: { ...current.answers, [key]: { ...(current.answers[key] ?? {}), ...answers } },
          };
        }),

      clearAnswers: (elementId) =>
        update((current) => {
          const answers = { ...current.answers };

          delete answers[String(elementId)];

          return { ...current, answers };
        }),
    }),
    [draft, hydrated, saveError, update],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}
