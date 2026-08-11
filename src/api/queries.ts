import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITY, STALE_MS } from '../config';
import { fetchAccessRequestInfo } from './mi-api';
import {
  fetchAppDatasetRows,
  fetchAuthInfo,
  fetchDraft,
  fetchQuestionMap,
  resolveQuestions,
  saveDraft,
} from './page-api';
import type { DraftPayload, RequestRow } from '../types/app';

export const queryKeys = {
  session: ['session'] as const,
  assetDetail: (elementId: number, segmentValueId: number) => ['asset-detail', elementId, segmentValueId] as const,
  questions: (elementId: number, segmentValueId: number) => ['questions', elementId, segmentValueId] as const,
  questionMap: ['question-map'] as const,
  draft: (key: string) => ['draft', key] as const,
  myRequests: ['my-requests'] as const,
};

/** The caller's identity, groups and custom attributes. Fetched once. */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => fetchAuthInfo(signal),
    staleTime: STALE_MS.session,
    gcTime: Infinity,
    retry: false,
  });
}

export function useAssetDetail(elementId: number | null, segmentValueId = 0) {
  return useQuery({
    queryKey: queryKeys.assetDetail(elementId ?? 0, segmentValueId),
    queryFn: ({ signal }) => fetchAccessRequestInfo(elementId as number, segmentValueId, signal),
    enabled: elementId !== null,
    staleTime: STALE_MS.assetDetail,
  });
}

/**
 * The resolved question set for one asset.
 *
 * This invokes a Custom Script, which occupies a PHP worker and a tab in the
 * shared headless Chromium for the duration of the run — so it is cached
 * hard, never refetched on window focus, and never retried automatically. A
 * failed run should surface to the user, not silently triple the load.
 */
export function useQuestions(elementId: number | null, segmentValueId = 0) {
  return useQuery({
    queryKey: queryKeys.questions(elementId ?? 0, segmentValueId),
    queryFn: ({ signal }) => resolveQuestions(elementId as number, segmentValueId, signal),
    enabled: elementId !== null,
    staleTime: STALE_MS.questions,
    gcTime: STALE_MS.questions,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useQuestionMap() {
  return useQuery({
    queryKey: queryKeys.questionMap,
    queryFn: ({ signal }) => fetchQuestionMap(signal),
    staleTime: STALE_MS.questionMap,
  });
}

/** The caller's own submitted requests. `managed` scoping does the filtering. */
export function useMyRequests(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myRequests,
    queryFn: ({ signal }) =>
      fetchAppDatasetRows<RequestRow>(ENTITY.requests, { limit: 500 }, signal).then((result) => result.rows),
    enabled,
    staleTime: STALE_MS.myRequests,
  });
}

export function useDraft(key: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.draft(key),
    queryFn: ({ signal }) => fetchDraft<DraftPayload>(key, signal),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Persist the draft.
 *
 * Called on every step transition. A multi-step form that loses its state on
 * refresh does not get completed, and the prototype this replaces ran to
 * nineteen steps.
 */
export function useSaveDraft(key: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: DraftPayload) => saveDraft(key, payload),
    onSuccess: (_result, payload) => {
      queryClient.setQueryData(queryKeys.draft(key), payload);
    },
  });
}
