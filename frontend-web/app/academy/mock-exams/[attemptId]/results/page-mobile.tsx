'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { MobileLayout, MobileButton } from '../../mobile-layout';
import { useViewport } from '@/hooks/useMediaQuery';
import { mockExamClient } from '@/lib/api/mockExamClient';

interface ExamResult {
  attemptId: string;
  templateId: string;
  templateName: string;
  score: number;
  grade: string;
  totalQuestions: number;
  correctAnswers: number;
  timeSpent: number;
  submittedAt: string;
  performanceBySubject: Array<{
    subject: string;
    score: number;
    totalQuestions: number;
  }>;
  recommendations: string[];
}

export default function MobileExamResultsPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = params.attemptId as string;
  const { isMobile } = useViewport();

  const [result, setResult] = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadResults = async () => {
      try {
        const data = await mockExamClient.getResults(attemptId);
        setResult(data);
      } catch (error) {
        console.error('Failed to load results:', error);
      } finally {
        setLoading(false);
      }
    };
    loadResults();
  }, [attemptId]);

  if (loading) {
    return (
      <MobileLayout title="Loading Results..." showBackButton onBack={() => router.back()}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </MobileLayout>
    );
  }

  if (!result) {
    return (
      <MobileLayout title="Results" showBackButton onBack={() => router.back()}>
        <div className="text-center py-8">
          <p className="text-slate-600">Unable to load results. Please try again.</p>
        </div>
      </MobileLayout>
    );
  }

  // Grade color mapping
  const gradeColors: Record<string, { bg: string; text: string; border: string }> = {
    A: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300' },
    B: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
    C: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-300' },
    D: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
    F: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  };

  const gradeColor = gradeColors[result.grade] || gradeColors.F;
  const minutes = Math.floor(result.timeSpent / 60);
  const seconds = result.timeSpent % 60;

  return (
    <MobileLayout title="Exam Results" showBackButton onBack={() => router.back()}>
      <div className="space-y-4">
        {/* Score Card */}
        <div className={`${gradeColor.bg} border-2 ${gradeColor.border} rounded-lg p-6 text-center space-y-2`}>
          <div className={`text-sm font-medium ${gradeColor.text}`}>Your Score</div>
          <div className={`text-4xl font-bold ${gradeColor.text}`}>{result.score}%</div>
          <div className={`text-lg font-semibold ${gradeColor.text}`}>Grade {result.grade}</div>
          <div className="text-sm text-slate-600 mt-3">
            {result.correctAnswers} of {result.totalQuestions} correct
          </div>
        </div>

        {/* Exam Info */}
        <div className="bg-slate-50 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Exam</span>
            <span className="font-medium text-slate-900">{result.templateName}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
            <span className="text-slate-600">Time Spent</span>
            <span className="font-medium text-slate-900">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </div>
          <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
            <span className="text-slate-600">Submitted</span>
            <span className="font-medium text-slate-900">
              {new Date(result.submittedAt).toLocaleDateString()} {new Date(result.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Performance by Subject */}
        {result.performanceBySubject.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900">Performance by Subject</h3>
            <div className="space-y-2">
              {result.performanceBySubject.map((subject) => {
                const percentage = Math.round((subject.score / subject.totalQuestions) * 100);
                return (
                  <div key={subject.subject} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700 font-medium">{subject.subject}</span>
                      <span className="text-slate-600">
                        {subject.score}/{subject.totalQuestions} ({percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          percentage >= 80
                            ? 'bg-green-500'
                            : percentage >= 60
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {result.recommendations.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900">Recommendations</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
              {result.recommendations.map((rec, idx) => (
                <div key={idx} className="flex gap-2 text-sm">
                  <span className="text-blue-600 font-semibold">•</span>
                  <span className="text-blue-700">{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-4">
          <MobileButton fullWidth variant="primary" onClick={() => router.push('/academy/mock-exams')}>
            Back to Exams
          </MobileButton>
          <MobileButton
            fullWidth
            variant="secondary"
            onClick={() => router.push(`/academy/mock-exams/${result.templateId}/take`)}
          >
            Retake Exam
          </MobileButton>
          <MobileButton
            fullWidth
            variant="secondary"
            onClick={() => router.push(`/academy/mock-exams/${result.attemptId}/analysis`)}
          >
            Detailed Analysis
          </MobileButton>
        </div>

        {/* Footer Message */}
        <div className="text-center text-xs text-slate-500 pt-4">
          {result.score >= 80 && <p>✨ Excellent performance! Keep practicing to maintain your score.</p>}
          {result.score >= 60 && result.score < 80 && (
            <p>💪 Good effort! Focus on weaker areas to improve further.</p>
          )}
          {result.score < 60 && <p>📚 Review the materials and try again to improve your score.</p>}
        </div>
      </div>
    </MobileLayout>
  );
}
