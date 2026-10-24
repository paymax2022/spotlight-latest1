// Starts a module-quiz attempt and opens it.
//
// A module quiz IS an exam (`module.quiz.id` is the exam id), and the attempt screen
// (`/film-academy/exams/[attemptId]`) takes an ATTEMPT id. Navigating there with the exam
// id — which My course used to do — opens nothing. The attempt has to be created first,
// exactly as the Exams list does.

import { useCallback, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { startExamAttempt, FILM_ACADEMY_EXAMS_KEY, FILM_ACADEMY_LEARN_KEY } from './api';
import { getErrorMessage } from '@/utils/errorMapper';
import { secureRandomId } from '@/lib/secureRandom';

export function useStartQuiz() {
  const queryClient = useQueryClient();
  const [startingId, setStartingId] = useState<string | null>(null);
  // A ref, not the state above: two taps in the same render both see the old state, and
  // each tap mints its own idempotency key, so the server would spend two attempts.
  const inFlight = useRef(false);
  const [error, setError] = useState<{ quizId: string; message: string } | null>(null);

  const start = useCallback(async (quizId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStartingId(quizId);
    setError(null);
    try {
      // A fresh key per tap: the server is idempotent per key, so a double-tap of THIS tap
      // cannot spend two attempts while a deliberate re-start after a refusal draws cleanly.
      const attempt = await startExamAttempt(quizId, secureRandomId());
      // Not awaited: the attempt already exists, so a slow refetch must not hold the
      // learner on a spinner before the quiz opens.
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_EXAMS_KEY });
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_LEARN_KEY });
      router.push(`/film-academy/exams/${attempt.attemptId}` as never);
    } catch (e) {
      setError({ quizId, message: getErrorMessage(e) });
    } finally {
      inFlight.current = false;
      setStartingId(null);
    }
  }, [queryClient]);

  return { start, startingId, error };
}
