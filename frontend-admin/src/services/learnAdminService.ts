// ── Admin — Learn Center content management ──────────────────────────────────
// Wires to the real Go backend: content-authoring mutations live under
// /api/v1/learn/admin (backend/internal/learn/admin.go, RBAC-gated on
// "learn.admin.manage"); read-mostly list endpoints (paths / lessons via path
// detail / glossary) live on the module root /api/v1/learn (backend/internal/
// learn/handler.go) since admin.go does not duplicate GET /paths list — it
// only exposes ListPathsAdmin under /admin/paths (includes unpublished).
//
// Money: none in this module (Learn Center has no money path).

import { apiV1 } from '@/config/env';

function adminBase(): string {
  return `${apiV1()}/learn/admin`;
}
function moduleBase(): string {
  return `${apiV1()}/learn`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function getJson<T>(path: string, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function del(path: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as { ok: boolean };
}

// ── Types (mirror backend/internal/learn/model.go + admin.go DTOs exactly) ───
export type LearnLevel = 'beginner' | 'stock' | 'crypto' | 'wealth';
export type LessonKind = 'article' | 'video';

export interface LearnPath {
  id: string;
  title: string;
  description: string;
  iconColor: string;
  level: LearnLevel;
  lessonIds: string[];
  progressPct: number;
}

export interface Lesson {
  id: string;
  pathId: string;
  title: string;
  durationMins: number;
  kind: LessonKind;
  body: string;
  summary: string;
}

export interface QuizOption {
  id: string;
  label: string;
  correct: boolean;
}
export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}
export interface Quiz {
  id: string;
  lessonId: string;
  questions: QuizQuestion[];
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface AdminPathInput {
  id?: string;
  title: string;
  description?: string;
  iconColor?: string;
  level: LearnLevel;
  sortOrder?: number;
  published?: boolean | null;
}

export interface AdminLessonInput {
  id?: string;
  pathId: string;
  title: string;
  durationMins?: number;
  kind: LessonKind;
  body?: string;
  summary?: string;
  sortOrder?: number;
}

export interface AdminQuizOptionInput {
  id?: string;
  label: string;
  isCorrect: boolean;
  sortOrder?: number;
}
export interface AdminQuizQuestionInput {
  id?: string;
  prompt: string;
  sortOrder?: number;
  options: AdminQuizOptionInput[];
}
export interface AdminQuizInput {
  id?: string;
  lessonId: string;
  questions: AdminQuizQuestionInput[];
}

export interface AdminGlossaryInput {
  term: string;
  definition: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────
// GET /admin/paths — list every path (incl. unpublished); admin-only listing.
export async function listPathsAdmin(): Promise<LearnPath[]> {
  return getJson<LearnPath[]>('/paths', 'admin');
}
export async function createPath(input: AdminPathInput): Promise<LearnPath> {
  return sendJson<LearnPath>('POST', '/paths', input);
}
export async function updatePath(id: string, input: AdminPathInput): Promise<LearnPath> {
  return sendJson<LearnPath>('PUT', `/paths/${id}`, input);
}
export async function deletePath(id: string): Promise<{ ok: boolean }> {
  return del(`/paths/${id}`);
}

// ── Lessons ───────────────────────────────────────────────────────────────────
export async function createLesson(input: AdminLessonInput): Promise<Lesson> {
  return sendJson<Lesson>('POST', '/lessons', input);
}
export async function updateLesson(id: string, input: AdminLessonInput): Promise<Lesson> {
  return sendJson<Lesson>('PUT', `/lessons/${id}`, input);
}
export async function deleteLesson(id: string): Promise<{ ok: boolean }> {
  return del(`/lessons/${id}`);
}
// GET /lessons/:id is on the module root, not /admin (routes.go).
export async function getLesson(id: string): Promise<Lesson> {
  return getJson<Lesson>(`/lessons/${id}`, 'module');
}
// GET /paths/:id (module root) returns lessonIds for a path — used to render
// a path's lesson list since there is no admin-scoped "lessons by path" GET.
export async function getPathDetail(id: string): Promise<LearnPath> {
  return getJson<LearnPath>(`/paths/${id}`, 'module');
}

// ── Quizzes (+ questions/options) ────────────────────────────────────────────
// GET /admin/quizzes/:id returns the quiz WITH the answer key (admin-only view).
export async function getQuizAdmin(id: string): Promise<Quiz> {
  return getJson<Quiz>(`/quizzes/${id}`, 'admin');
}
export async function createQuiz(input: AdminQuizInput): Promise<Quiz> {
  return sendJson<Quiz>('POST', '/quizzes', input);
}
export async function updateQuiz(id: string, input: AdminQuizInput): Promise<Quiz> {
  return sendJson<Quiz>('PUT', `/quizzes/${id}`, input);
}
export async function deleteQuiz(id: string): Promise<{ ok: boolean }> {
  return del(`/quizzes/${id}`);
}

// ── Glossary ──────────────────────────────────────────────────────────────────
// POST /admin/glossary — create/update (upsert) a glossary term.
export async function upsertGlossary(input: AdminGlossaryInput): Promise<GlossaryTerm> {
  return sendJson<GlossaryTerm>('POST', '/glossary', input);
}
export async function deleteGlossary(term: string): Promise<{ ok: boolean }> {
  return del(`/glossary/${encodeURIComponent(term)}`);
}
// GET /glossary is on the module root (routes.go), not /admin.
export async function listGlossary(): Promise<GlossaryTerm[]> {
  return getJson<GlossaryTerm[]>('/glossary', 'module');
}
