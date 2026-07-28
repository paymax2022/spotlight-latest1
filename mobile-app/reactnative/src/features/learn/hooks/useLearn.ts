// ── Paymax Invest · Learn Center — Data hooks ────────────────────────────────
// React Query hooks mirroring useCrypto.ts so Learn screens stay declarative and
// share the same caching / loading / error contracts. Content is read-mostly;
// submitting a quiz is the only mutation.

import { useMutation, useQuery } from '@tanstack/react-query';
import * as learn from '../api/learn.api';
import type { QuizAnswers } from '../types/learn.types';

const KEY = 'learn';

// ─── Paths ────────────────────────────────────────────────────────────────--

export function useLearnPaths() {
  return useQuery({ queryKey: [KEY, 'paths'], queryFn: learn.getPaths, staleTime: 60_000 });
}

export function useLearnPath(id?: string) {
  return useQuery({
    queryKey: [KEY, 'path', id],
    queryFn: () => learn.getPath(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Lessons ──────────────────────────────────────────────────────────────--

export function useLesson(id?: string) {
  return useQuery({
    queryKey: [KEY, 'lesson', id],
    queryFn: () => learn.getLesson(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Quiz ─────────────────────────────────────────────────────────────────--

export function useQuiz(lessonId?: string) {
  return useQuery({
    queryKey: [KEY, 'quiz', lessonId],
    queryFn: () => learn.getQuiz(lessonId as string),
    enabled: Boolean(lessonId),
    staleTime: 60_000,
  });
}

export function useSubmitQuiz() {
  return useMutation({
    mutationFn: ({ quizId, answers }: { quizId: string; answers: QuizAnswers }) =>
      learn.submitQuiz(quizId, answers),
  });
}

// ─── Glossary ────────────────────────────────────────────────────────────--

export function useGlossary() {
  return useQuery({ queryKey: [KEY, 'glossary'], queryFn: learn.getGlossary, staleTime: 300_000 });
}
