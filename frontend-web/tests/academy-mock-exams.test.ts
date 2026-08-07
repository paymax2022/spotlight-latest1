import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockExamClient } from '@/lib/api/mockExamClient';

// Mock fetch globally
global.fetch = vi.fn();

describe('Mock Exam API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTemplates', () => {
    it('should fetch templates without filters', async () => {
      const mockData = {
        data: [
          {
            id: 'template-1',
            name: 'P6 Full Exam',
            description: 'Complete P6 mock exam',
            exam_type: 'class_mock',
            total_questions: 50,
            total_minutes: 120,
            difficulty_distribution: { easy: 10, medium: 25, hard: 15 },
            status: 'approved',
          },
        ],
        count: 1,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      const result = await mockExamClient.listTemplates();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('P6 Full Exam');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/academy/mock-exams/templates')
      );
    });

    it('should fetch templates with filters', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], count: 0 }),
      });

      await mockExamClient.listTemplates({ class_id: 'p6', exam_type: 'class_mock' });

      const callUrl = (global.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('class_id=p6');
      expect(callUrl).toContain('exam_type=class_mock');
    });

    it('should handle fetch errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(mockExamClient.listTemplates()).rejects.toThrow('Failed to fetch templates');
    });
  });

  describe('startExam', () => {
    it('should start a new exam attempt', async () => {
      const mockAttempt = {
        id: 'attempt-123',
        instance_id: 'instance-456',
        status: 'in_progress',
        progress: 0,
        time_elapsed: 0,
        started_at: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockAttempt }),
      });

      const result = await mockExamClient.startExam('template-1');

      expect(result.id).toBe('attempt-123');
      expect(result.status).toBe('in_progress');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/academy/mock-exams/start'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('getProgress', () => {
    it('should retrieve exam progress with questions', async () => {
      const mockProgress = {
        attempt_id: 'attempt-123',
        exam_code: 'EXAM-P6-001',
        template_name: 'P6 Full Exam',
        progress: 25,
        time_elapsed: 900,
        time_remaining: 6300,
        total_questions: 50,
        answered_count: 12,
        flagged_count: 2,
        questions: [
          {
            id: 'q1',
            text: 'What is 2+2?',
            options: ['a', 'b', 'c', 'd'],
            difficulty: 'easy',
          },
        ],
        current_answers: { q1: 'a' },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockProgress }),
      });

      const result = await mockExamClient.getProgress('attempt-123');

      expect(result.progress).toBe(25);
      expect(result.answered_count).toBe(12);
      expect(result.flagged_count).toBe(2);
      expect(result.questions).toHaveLength(1);
    });
  });

  describe('saveProgress', () => {
    it('should save exam answers', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const answers = { q1: 'a', q2: 'b', q3: 'c' };
      const flagged = ['q4', 'q5'];

      await mockExamClient.saveProgress('attempt-123', answers, flagged);

      const call = (global.fetch as any).mock.calls[0];
      expect(call[0]).toContain('/api/academy/mock-exams/attempts/attempt-123/save');
      expect(call[1].method).toBe('POST');
    });
  });

  describe('submitExam', () => {
    it('should submit exam and return result', async () => {
      const mockResult = {
        id: 'result-123',
        score: 38,
        score_percent: 76,
        grade: 'B',
        status: 'graded',
        total_time: 3600,
        performance: {
          correct_answers: 38,
          total_answered: 50,
          unanswered: 0,
        },
        submitted_at: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockResult }),
      });

      const result = await mockExamClient.submitExam('attempt-123', {});

      expect(result.score_percent).toBe(76);
      expect(result.grade).toBe('B');
      expect(result.status).toBe('graded');
    });
  });

  describe('getResults', () => {
    it('should retrieve exam results with performance data', async () => {
      const mockResults = {
        id: 'result-123',
        score: 38,
        score_percent: 76,
        grade: 'B',
        status: 'graded',
        total_time: 3600,
        performance: {
          correct_answers: 38,
          total_answered: 50,
          unanswered: 0,
        },
        submitted_at: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockResults }),
      });

      const result = await mockExamClient.getResults('attempt-123');

      expect(result.score_percent).toBe(76);
      expect(result.performance.correct_answers).toBe(38);
    });
  });

  describe('getLearnerAnalytics', () => {
    it('should retrieve learner analytics with trends', async () => {
      const mockAnalytics = {
        total_attempts: 12,
        average_score: 72.5,
        best_score: 88.0,
        worst_score: 54.0,
        pass_rate: 83.3,
        trend_data: [
          { date: '2026-08-01', score: 68.0, average: 70.0 },
          { date: '2026-08-02', score: 72.5, average: 71.0 },
        ],
        subject_performance: [
          { subject: 'Mathematics', average: 68.0, attempts: 4 },
          { subject: 'English', average: 75.0, attempts: 3 },
        ],
        weak_areas: [
          { topic: 'Algebraic Functions', accuracy: 62.0 },
        ],
        attempts: [
          {
            template_name: 'P6 Full Exam',
            exam_type: 'class_mock',
            score_percent: 82.0,
            grade: 'B',
            attempted_at: '2026-08-05',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockAnalytics }),
      });

      const result = await mockExamClient.getLearnerAnalytics();

      expect(result.total_attempts).toBe(12);
      expect(result.average_score).toBe(72.5);
      expect(result.trend_data).toHaveLength(2);
      expect(result.subject_performance).toHaveLength(2);
      expect(result.weak_areas).toHaveLength(1);
    });
  });

  describe('getAdminAnalytics', () => {
    it('should retrieve admin analytics with time range', async () => {
      const mockAdminAnalytics = {
        total_learners: 1247,
        total_attempts: 8932,
        active_this_week: 612,
        average_system_score: 71.8,
        pass_rate: 78.5,
        activity_data: [
          { date: '2026-08-01', attempts: 1200, unique_learners: 450 },
        ],
        class_performance: [
          { class: 'P6', avg_score: 74.3, pass_rate: 82.0, learners: 110 },
        ],
        grade_distribution: [
          { grade: 'A', count: 1200 },
          { grade: 'B', count: 2100 },
        ],
        exam_statistics: [
          { name: 'P6 Full Exam', attempts: 1250, avg_score: 76.5, pass_rate: 85.0 },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockAdminAnalytics }),
      });

      const result = await mockExamClient.getAdminAnalytics('week');

      expect(result.total_learners).toBe(1247);
      expect(result.total_attempts).toBe(8932);
      expect(result.pass_rate).toBe(78.5);
    });
  });
});

describe('Mock Exam Client - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw on network error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    await expect(mockExamClient.listTemplates()).rejects.toThrow('Network error');
  });

  it('should throw on non-OK response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    });

    await expect(mockExamClient.getResults('attempt-123')).rejects.toThrow(
      'Failed to fetch results'
    );
  });

  it('should include query parameters in correct format', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await mockExamClient.listTemplates({ class_id: 'p6', limit: 10 });

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain('class_id=p6');
    expect(url).toContain('limit=10');
  });
});
