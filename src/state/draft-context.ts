import { createContext, useContext } from 'react';
import type { AnswerMap, AnswerValue } from '../types/app';

/**
 * In-progress answers, split from their provider so the provider module
 * exports only components and stays eligible for Fast Refresh.
 */
export interface DraftContextValue {
  /** False until the server-side draft has been read (or found absent). */
  ready: boolean;
  answersFor: (elementId: number) => AnswerMap;
  setAnswer: (elementId: number, question: string, value: AnswerValue) => void;
  mergeAnswers: (elementId: number, answers: AnswerMap) => void;
  clearAnswers: (elementId: number) => void;
  /** Set when the last save failed. Rendering continues regardless. */
  saveError: string | null;
}

export const DraftContext = createContext<DraftContextValue | null>(null);

export function useDraftStore(): DraftContextValue {
  const context = useContext(DraftContext);

  if (!context) {
    throw new Error('useDraftStore must be used inside a DraftProvider');
  }

  return context;
}
