/**
 * Mock Exam API Client
 * Centralized API interaction for mock exam system
 *
 * Member calls go through the same-origin catch-all proxy
 *   /api/v1/academy/mock-exams/<...>  →  Go /api/finance/academy/mock-exams/<...>
 * (app/api/v1/academy/[...path]/route.ts → assessment.RegisterMockExamRoutes).
 * The proxy requires a Supabase Bearer token, so every call goes through
 * authFetch — a bare fetch() would 401 at requireRequestUser before reaching Go.
 *
 * Admin calls go through /api/academy/admin/<...> → Go /api/academy/admin/<...>
 * (app/api/academy/admin/[...path]/route.ts). Go admin routes self-gate on RBAC
 * academy.* slugs.
 */

import { authFetch } from '@/src/lib/auth/flow';

const API_BASE = '/api/v1/academy/mock-exams';
const ADMIN_API_BASE = '/api/academy/admin/mock-exams';

export interface MockExamTemplate {
  id: string;
  name: string;
  description: string;
  exam_type: string;
  total_questions: number;
  total_minutes: number;
  difficulty_distribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  status: string;
}

export interface ExamAttempt {
  id: string;
  instance_id: string;
  status: string;
  progress: number;
  time_elapsed: number;
  started_at: string;
}

export interface ExamProgress {
  attempt_id: string;
  exam_code: string;
  template_name: string;
  progress: number;
  time_elapsed: number;
  time_remaining: number;
  total_questions: number;
  answered_count: number;
  flagged_count: number;
  questions: any[];
  current_answers: Record<string, any>;
}

export interface ExamResult {
  id: string;
  score: number;
  score_percent: number;
  grade: string;
  status: string;
  total_time: number;
  performance: any;
  submitted_at: string;
}

export interface LearnerAnalytics {
  total_attempts: number;
  average_score: number;
  best_score: number;
  worst_score: number;
  pass_rate: number;
  trend_data: Array<{ date: string; score: number; average: number }>;
  subject_performance: Array<{ subject: string; average: number; attempts: number }>;
  weak_areas: Array<{ topic: string; accuracy: number }>;
  attempts: any[];
}

export interface AdminAnalytics {
  total_learners: number;
  total_attempts: number;
  active_this_week: number;
  average_system_score: number;
  pass_rate: number;
  activity_data: any[];
  class_performance: any[];
  grade_distribution: any[];
  exam_statistics: any[];
}

class MockExamClient {
  /**
   * List available exam templates
   */
  async listTemplates(filters?: {
    class_id?: string;
    exam_type?: string;
    limit?: number;
  }): Promise<{ data: MockExamTemplate[]; count: number }> {
    const params = new URLSearchParams();
    if (filters?.class_id) params.append('class_id', filters.class_id);
    if (filters?.exam_type) params.append('exam_type', filters.exam_type);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const response = await authFetch(`${API_BASE}/templates?${params}`);
    if (!response.ok) throw new Error(`Failed to fetch templates: ${response.statusText}`);
    return response.json();
  }

  /**
   * Get a specific exam template with instances
   */
  async getTemplate(templateId: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/templates/${templateId}`);
    if (!response.ok) throw new Error(`Failed to fetch template: ${response.statusText}`);
    return response.json();
  }

  /**
   * Start a new exam attempt
   */
  async startExam(templateId: string): Promise<ExamAttempt> {
    const response = await authFetch(`${API_BASE}/start`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId }),
    }, { json: true });
    if (!response.ok) throw new Error(`Failed to start exam: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Get current exam progress and questions
   */
  async getProgress(attemptId: string): Promise<ExamProgress> {
    const response = await authFetch(`${API_BASE}/attempts/${attemptId}`);
    if (!response.ok) throw new Error(`Failed to fetch exam progress: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Save exam answers and flagged questions
   */
  async saveProgress(
    attemptId: string,
    answers: Record<string, any>,
    flaggedQuestions: string[]
  ): Promise<void> {
    const response = await authFetch(`${API_BASE}/attempts/${attemptId}/save`, {
      method: 'POST',
      body: JSON.stringify({
        answers,
        flagged_questions: flaggedQuestions,
      }),
    }, { json: true });
    if (!response.ok) throw new Error(`Failed to save progress: ${response.statusText}`);
  }

  /**
   * Submit exam and get results
   */
  async submitExam(attemptId: string, answers: Record<string, any>): Promise<ExamResult> {
    const response = await authFetch(`${API_BASE}/attempts/${attemptId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }, { json: true });
    if (!response.ok) throw new Error(`Failed to submit exam: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Get exam results
   */
  async getResults(attemptId: string): Promise<ExamResult> {
    const response = await authFetch(`${API_BASE}/results/${attemptId}`);
    if (!response.ok) throw new Error(`Failed to fetch results: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Get template statistics
   */
  async getStatistics(templateId: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/statistics/${templateId}`);
    if (!response.ok) throw new Error(`Failed to fetch statistics: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Get learner's personal analytics
   */
  async getLearnerAnalytics(): Promise<LearnerAnalytics> {
    const response = await authFetch(`${API_BASE}/analytics`);
    if (!response.ok) throw new Error(`Failed to fetch analytics: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }

  /**
   * Get system-wide analytics (admin only)
   */
  async getAdminAnalytics(timeRange?: string): Promise<AdminAnalytics> {
    const params = new URLSearchParams();
    if (timeRange) params.append('timeRange', timeRange);

    const response = await authFetch(`${ADMIN_API_BASE}/analytics?${params}`);
    if (!response.ok) throw new Error(`Failed to fetch admin analytics: ${response.statusText}`);
    const data = await response.json();
    return data.data;
  }
}

export const mockExamClient = new MockExamClient();
