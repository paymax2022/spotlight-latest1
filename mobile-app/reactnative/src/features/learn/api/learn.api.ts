// Paymax Invest · Learn Center — API wrapper.
//
// The Learn surface is read-mostly: getPaths / getPath / getLesson / getQuiz /
// getGlossary are GETs; submitQuiz is the only mutation and is scored server-side
// (the client never decides pass/fail authoritatively).
//
// LIVE: backend/internal/learn (service+handler+routes) is registered on the Go
// router under /api/v1/learn/* (see backend/internal/app/learn_routes.go), backed
// by the learn_* tables (migration 20260912000000_learn_center.sql), and the
// frontend-web catch-all proxy at app/api/v1/learn/[...path]/route.ts forwards to
// it. backend/tests/learn passes green. Defaults to live — set
// EXPO_PUBLIC_LEARN_USE_MOCK=true to force mock locally.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
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

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_LEARN_USE_MOCK, false);

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

// submitQuiz is the module's only write. Its live route exists and passes
// backend/tests/learn, so fixture mode refuses loudly instead of grading a quiz
// the server never scored — mirrors frontend-admin's crowdfundingAdminService.ts
// NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a result the server did not compute. Set EXPO_PUBLIC_LEARN_USE_MOCK=false to send this against the live backend.`);

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
  if (USE_MOCK) throw notInFixtureMode('Submitting a quiz');
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
