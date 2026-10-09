/**
 * CMS-009 — learn center: admin content CRUD (path → lesson → quiz → glossary)
 * → member surface (paths/progress, lesson read tracking, quiz with scrubbed
 * answer key, authoritative server-side scoring, glossary).
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  goFetch,
  goTrueToken,
  grantAdminPerm,
  provisionVerifiedUser,
} from './helpers';

test.describe('CMS-009 learn: admin content lifecycle → member consumption', () => {
  test('admin authors path/lesson/quiz; member reads, takes quiz, glossary', async ({ request }) => {
    grantAdminPerm('learn.admin.manage');
    const tag = `${Date.now() % 100000}`;

    // ── Admin authoring ────────────────────────────────────────────────────
    const mkPath = await adminFetch(request, '/api/v1/learn/admin/paths', {
      method: 'POST',
      data: { title: `E2E Path ${tag}`, description: 'e2e', iconColor: '#000', level: 'beginner', sortOrder: 999 },
    });
    expect([200,201]).toContain(mkPath.status);
    const pathId = mkPath.body?.id;
    expect(pathId).toBeTruthy();

    const mkLesson = await adminFetch(request, '/api/v1/learn/admin/lessons', {
      method: 'POST',
      data: { pathId, title: `E2E Lesson ${tag}`, kind: 'article', body: 'e2e body', summary: 'e2e', durationMins: 5 },
    });
    expect([200,201]).toContain(mkLesson.status);
    const lessonId = mkLesson.body?.id;
    expect(lessonId).toBeTruthy();

    const mkQuiz = await adminFetch(request, '/api/v1/learn/admin/quizzes', {
      method: 'POST',
      data: {
        lessonId,
        questions: [
          {
            prompt: 'What is a kobo?',
            options: [
              { label: 'Minor unit', isCorrect: true },
              { label: 'A fish', isCorrect: false },
            ],
          },
        ],
      },
    });
    expect([200,201]).toContain(mkQuiz.status);
    const quizId = mkQuiz.body?.id;
    const questionId = mkQuiz.body?.questions?.[0]?.id;
    const correctOptionId = mkQuiz.body?.questions?.[0]?.options?.find((o: any) => o.correct === true)?.id;
    const wrongOptionId = mkQuiz.body?.questions?.[0]?.options?.find((o: any) => !o.correct)?.id;
    expect(quizId && questionId && correctOptionId && wrongOptionId).toBeTruthy();

    // Update + list surfaces.
    const upPath = await adminFetch(request, `/api/v1/learn/admin/paths/${pathId}`, {
      method: 'PUT',
      data: { title: `E2E Path ${tag} v2`, level: 'beginner', sortOrder: 999 },
    });
    expect(upPath.status).toBe(200);
    const listPaths = await adminFetch(request, '/api/v1/learn/admin/paths');
    expect(listPaths.status).toBe(200);
    const adminQuiz = await adminFetch(request, `/api/v1/learn/admin/quizzes/${quizId}`);
    expect(adminQuiz.status).toBe(200);

    // Glossary upsert + member read + delete.
    const upTerm = await adminFetch(request, '/api/v1/learn/admin/glossary', {
      method: 'POST',
      data: { term: `e2e-term-${tag}`, definition: 'e2e def' },
    });
    expect([200,201]).toContain(upTerm.status);

    // ── Member consumption ─────────────────────────────────────────────────
    const user = await provisionVerifiedUser(request, 'cms-lrn');
    const token = await goTrueToken(request, user.email, user.password);

    const paths = await goFetch(request, '/api/v1/learn/paths', { token });
    expect(paths.status).toBe(200);
    const detail = await goFetch(request, `/api/v1/learn/paths/${pathId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.body?.lessonIds).toContain(lessonId);

    // Lesson read (marks progress server-side).
    const lesson = await goFetch(request, `/api/v1/learn/lessons/${lessonId}`, { token });
    expect(lesson.status).toBe(200);
    expect(lesson.body?.title).toContain('E2E Lesson');
    const detail2 = await goFetch(request, `/api/v1/learn/paths/${pathId}`, { token });
    expect(detail2.body?.progressPct).toBeGreaterThanOrEqual(detail.body?.progressPct ?? 0);

    // Member quiz payload must have the answer key scrubbed.
    const quiz = await goFetch(request, `/api/v1/learn/lessons/${lessonId}/quiz`, { token });
    expect(quiz.status).toBe(200);
    for (const q of quiz.body?.questions ?? []) {
      for (const o of q.options ?? []) {
        expect(o.correct).toBe(false);
      }
    }

    // Authoritative scoring: wrong → fail, right → pass (attempt rows append).
    const fail = await goFetch(request, `/api/v1/learn/quizzes/${quizId}/submit`, {
      method: 'POST',
      token,
      data: { answers: { [questionId]: wrongOptionId } },
    });
    expect(fail.status).toBe(200);
    expect(fail.body?.passed).toBe(false);
    const pass = await goFetch(request, `/api/v1/learn/quizzes/${quizId}/submit`, {
      method: 'POST',
      token,
      data: { answers: { [questionId]: correctOptionId } },
    });
    expect(pass.status).toBe(200);
    expect(pass.body?.passed).toBe(true);
    expect(pass.body?.score).toBe(1);

    const glossary = await goFetch(request, '/api/v1/learn/glossary', { token });
    expect(glossary.status).toBe(200);
    expect(glossary.body?.some((g: any) => g.term === `e2e-term-${tag}`)).toBe(true);

    // ── Teardown via admin delete surface (covers DELETE handlers) ─────────
    const delQuiz = await adminFetch(request, `/api/v1/learn/admin/quizzes/${quizId}`, { method: 'DELETE' });
    expect(delQuiz.status).toBe(200);
    const delLesson = await adminFetch(request, `/api/v1/learn/admin/lessons/${lessonId}`, { method: 'DELETE' });
    expect(delLesson.status).toBe(200);
    const delPath = await adminFetch(request, `/api/v1/learn/admin/paths/${pathId}`, { method: 'DELETE' });
    expect(delPath.status).toBe(200);
    const delTerm = await adminFetch(request, `/api/v1/learn/admin/glossary/e2e-term-${tag}`, { method: 'DELETE' });
    expect(delTerm.status).toBe(200);
  });

  test('permission gate + validation guards', async ({ request }) => {
    // Member bearer (no learn.admin.manage) → 403 on admin surface.
    const user = await provisionVerifiedUser(request, 'cms-lrnx');
    const token = await goTrueToken(request, user.email, user.password);
    const denied = await goFetch(request, '/api/v1/learn/admin/paths', {
      method: 'POST',
      token,
      data: { title: 'x', level: 'beginner' },
    });
    expect(denied.status).toBe(403);

    grantAdminPerm('learn.admin.manage');
    // Invalid level → 400.
    const badLevel = await adminFetch(request, '/api/v1/learn/admin/paths', {
      method: 'POST',
      data: { title: 'x', level: 'wizard' },
    });
    expect(badLevel.status).toBe(400);
    // Unknown lesson → 404 member read; unknown quiz submit → 404.
    const ghost = await goFetch(request, '/api/v1/learn/lessons/lesson_missing', { token });
    expect(ghost.status).toBe(404);
    const badSubmit = await goFetch(request, '/api/v1/learn/quizzes/quiz_missing/submit', {
      method: 'POST',
      token,
      data: { answers: {} },
    });
    expect(badSubmit.status).toBe(404);
  });
});
