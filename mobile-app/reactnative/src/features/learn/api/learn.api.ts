// Typed data layer the Learn screens code against (Backend role owns this file).
// the real Paymax /api/v1/learn/* endpoints (docs/crypto/api.md envelope) land.
// The Learn surface is read-mostly: getPaths / getPath / getLesson / getQuiz /
// in production (the client never decides pass/fail authoritatively).
// GO-LIVE (2026-07): the real backend module now EXISTS —
// backend/internal/learn (service+handler+routes) is registered on the Go router
// under /api/v1/learn/* (see backend/internal/app/learn_routes.go), backed by the
// learn_* tables (migration 20260912000000_learn_center.sql). Content matches
// these mock fixtures, so a flipped client renders identical copy.
// proxy. Add a catch-all at frontend-web/app/api/v1/learn/[...path]/route.ts (a
// thin mirror of the existing app/api/v1/invest proxy) that forwards to the Go
// backend's /api/v1/learn/*. Once that proxy lands, flip the flag — the live
// paths below already match the Go routes exactly.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { QUIZ_PASS_RATIO } from '../constants/learn.constants';
import {
  MOCK_GLOSSARY,
  MOCK_LESSONS,
  MOCK_PATHS,
  MOCK_QUIZZES,
} from './learn.mock';
import type {
  GlossaryTerm,
  Lesson,
  LearnPath,
  Quiz,
  QuizAnswers,
  QuizResult,
} from '../types/learn.types';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_LEARN_USE_MOCK, true);

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/** Normalise a thrown axios error into the Go backend's real message. */
function toLearnError(err: unknown): Error {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  return new Error(msg);
}

export async function getPaths(): Promise<LearnPath[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_PATHS]; }
  return unwrap<LearnPath[]>(await api.get('/api/v1/learn/paths'));
}

export async function getPath(id: string): Promise<LearnPath> {
  if (USE_MOCK) {
    await delay(220);
    const path = MOCK_PATHS.find((p) => p.id === id);
    if (!path) throw new Error('Learning path not found');
    return path;
  }
  return unwrap<LearnPath>(await api.get(`/api/v1/learn/paths/${id}`));
}

export async function getLesson(id: string): Promise<Lesson> {
  if (USE_MOCK) {
    await delay(220);
    const lesson = MOCK_LESSONS.find((l) => l.id === id);
    if (!lesson) throw new Error('Lesson not found');
    return lesson;
  }
  return unwrap<Lesson>(await api.get(`/api/v1/learn/lessons/${id}`));
}

/** Resolve the quiz attached to a lesson, or null if the lesson has none. */
export async function getQuiz(lessonId: string): Promise<Quiz | null> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_QUIZZES.find((q) => q.lessonId === lessonId) ?? null;
  }
  try {
    return unwrap<Quiz>(await api.get(`/api/v1/learn/lessons/${lessonId}/quiz`));
  } catch {
    return null; // 404 → lesson simply has no quiz
  }
}

// Scored server-side in production. The mock grades against the answer key so
// the result/retake path is reachable end-to-end.

export async function submitQuiz(quizId: string, answers: QuizAnswers): Promise<QuizResult> {
  if (USE_MOCK) {
    await delay(700);
    const quiz = MOCK_QUIZZES.find((q) => q.id === quizId);
    if (!quiz) throw new Error('Quiz not found');
    const total = quiz.questions.length;
    const score = quiz.questions.reduce((n, q) => {
      const chosen = answers[q.id];
      const correct = q.options.find((o) => o.correct)?.id;
      return n + (chosen && chosen === correct ? 1 : 0);
    }, 0);
    return { score, total, passed: total > 0 && score / total >= QUIZ_PASS_RATIO };
  }
  try {
    return unwrap<QuizResult>(await api.post(`/api/v1/learn/quizzes/${quizId}/submit`, { answers }));
  } catch (err) {
    throw toLearnError(err);
  }
}

export async function getGlossary(): Promise<GlossaryTerm[]> {
  if (USE_MOCK) {
    await delay(240);
    return [...MOCK_GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  }
  return unwrap<GlossaryTerm[]>(await api.get('/api/v1/learn/glossary'));
}
