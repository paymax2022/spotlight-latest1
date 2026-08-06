'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  MobileLayout,
  MobileButton,
  QuestionNavigator,
  ExamTimer,
  ExamStats,
} from '../../mobile-layout';
import { useViewport } from '@/hooks/useMediaQuery';
import { useSwipeGesture, useSwipeFeedback } from '@/hooks/useSwipeGesture';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { mockExamClient } from '@/lib/api/mockExamClient';

interface Question {
  id: string;
  number: number;
  text: string;
  options: string[];
  type: 'multiple-choice' | 'true-false' | 'short-answer';
}

interface ExamState {
  answers: Record<number, string>;
  flagged: Set<number>;
  currentQuestion: number;
}

export default function MobileExamTakeEnhancedPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.templateId as string;
  const { isMobile } = useViewport();
  const network = useNetworkStatus();
  const contentRef = useRef<HTMLDivElement>(null);
  const translateX = useSwipeFeedback(contentRef);

  // Exam state
  const [examState, setExamState] = useState<ExamState>({
    answers: {},
    flagged: new Set(),
    currentQuestion: 1,
  });
  const [timeRemaining, setTimeRemaining] = useState(5400);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showNetworkWarning, setShowNetworkWarning] = useState(!network.isOnline);
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);

  // Load exam template
  useEffect(() => {
    const loadExam = async () => {
      try {
        const template = await mockExamClient.getTemplate(templateId);
        const mockQuestions: Question[] = Array.from({ length: 50 }, (_, i) => ({
          id: `q${i + 1}`,
          number: i + 1,
          text: `Question ${i + 1}: ${template.name}`,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          type: 'multiple-choice',
        }));
        setQuestions(mockQuestions);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load exam:', error);
        setLoading(false);
      }
    };
    loadExam();
  }, [templateId]);

  // Network status monitoring
  useEffect(() => {
    setShowNetworkWarning(!network.isOnline);
  }, [network.isOnline]);

  // Timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 0) {
          clearInterval(interval);
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-save progress
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      saveProgress();
    }, 30000);
    return () => clearInterval(autoSaveInterval);
  }, [examState]);

  // Setup swipe gestures
  useSwipeGesture(contentRef, {
    onSwipeLeft: () => handleNextQuestion(),
    onSwipeRight: () => handlePreviousQuestion(),
    threshold: 50,
    preventDefault: false,
  });

  const currentQuestion = questions[examState.currentQuestion - 1];
  const answeredCount = Object.keys(examState.answers).length;
  const unansweredCount = questions.length - answeredCount;
  const flaggedCount = examState.flagged.size;
  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  const handleAnswerChange = useCallback((answer: string) => {
    setExamState((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        [prev.currentQuestion]: answer,
      },
    }));
  }, []);

  const handleFlagQuestion = useCallback(() => {
    setExamState((prev) => {
      const newFlagged = new Set(prev.flagged);
      if (newFlagged.has(prev.currentQuestion)) {
        newFlagged.delete(prev.currentQuestion);
      } else {
        newFlagged.add(prev.currentQuestion);
      }
      return {
        ...prev,
        flagged: newFlagged,
      };
    });
  }, []);

  const handleSelectQuestion = useCallback((questionNum: number) => {
    setExamState((prev) => ({
      ...prev,
      currentQuestion: questionNum,
    }));
    // Scroll to top on question change
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, []);

  const handlePreviousQuestion = useCallback(() => {
    setExamState((prev) => ({
      ...prev,
      currentQuestion: Math.max(1, prev.currentQuestion - 1),
    }));
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, []);

  const handleNextQuestion = useCallback(() => {
    setExamState((prev) => ({
      ...prev,
      currentQuestion: Math.min(questions.length, prev.currentQuestion + 1),
    }));
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, []);

  const saveProgress = async () => {
    try {
      await mockExamClient.saveProgress(templateId, {
        answers: examState.answers,
        flagged: Array.from(examState.flagged),
      });
      setLastSaveTime(new Date());
    } catch (error) {
      console.error('Failed to save progress:', error);
      if (!network.isOnline) {
        setShowNetworkWarning(true);
      }
    }
  };

  const handleSubmitExam = async () => {
    setSubmitting(true);
    try {
      await saveProgress();
      const result = await mockExamClient.submitExam(templateId, {
        answers: examState.answers,
        timeSpent: 5400 - timeRemaining,
      });
      router.push(`/academy/mock-exams/${result.attemptId}/results`);
    } catch (error) {
      console.error('Failed to submit exam:', error);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <MobileLayout title="Loading Exam..." showBackButton onBack={() => router.back()}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </MobileLayout>
    );
  }

  if (!currentQuestion) {
    return <div>Error loading exam</div>;
  }

  return (
    <MobileLayout title="Practice Exam" showBackButton onBack={() => router.back()}>
      {/* Network Status Warning */}
      {showNetworkWarning && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <span className="text-red-600 font-bold text-lg">⚠</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">Offline</p>
            <p className="text-xs text-red-700">
              {network.isOnline
                ? 'Answers will be saved when online'
                : 'No internet. Answers saved locally.'}
            </p>
          </div>
        </div>
      )}

      {/* Network Performance Info */}
      {network.isSlow && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-700">
            📊 Slow network detected ({network.effectiveType}). Images are optimized.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Header with timer and stats */}
        <div className="sticky top-12 z-20 bg-white p-3 rounded-lg border border-slate-200 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">Time Remaining</span>
            <ExamTimer timeRemaining={timeRemaining} totalTime={5400} />
          </div>
          <ExamStats answered={answeredCount} unanswered={unansweredCount} flagged={flaggedCount} />

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Progress</span>
              <span className="font-medium text-slate-900">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Question Navigator */}
        <QuestionNavigator
          totalQuestions={questions.length}
          answeredQuestions={new Set(Object.keys(examState.answers).map(Number))}
          flaggedQuestions={examState.flagged}
          currentQuestion={examState.currentQuestion}
          onSelectQuestion={handleSelectQuestion}
        />

        {/* Question Content - Swipeable */}
        <div
          ref={contentRef}
          className="space-y-4 max-h-[60vh] overflow-y-auto"
          style={{
            transform: `translateX(${translateX}px)`,
            transition: translateX === 0 ? 'transform 0.2s ease-out' : 'none',
          }}
        >
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-900">
              Question {examState.currentQuestion} of {questions.length}
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mt-2">{currentQuestion.text}</h2>
          </div>

          {/* Swipe hint for mobile */}
          {isMobile && (
            <div className="text-center text-xs text-slate-400">
              ← Swipe to navigate between questions →
            </div>
          )}

          {/* Answer Options */}
          <div className="space-y-2">
            {currentQuestion.options.map((option, idx) => {
              const optionLabel = String.fromCharCode(65 + idx);
              const isSelected = examState.answers[examState.currentQuestion] === optionLabel;

              return (
                <label
                  key={idx}
                  className={`
                    flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer
                    transition-all duration-150
                    ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="answer"
                    value={optionLabel}
                    checked={isSelected}
                    onChange={() => handleAnswerChange(optionLabel)}
                    className="mt-1 w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{optionLabel}</div>
                    <div className="text-sm text-slate-600">{option}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Flag Button */}
          <button
            onClick={handleFlagQuestion}
            className={`
              w-full py-3 px-4 rounded-lg font-medium transition-colors
              ${
                examState.flagged.has(examState.currentQuestion)
                  ? 'bg-orange-100 text-orange-700 border border-orange-300'
                  : 'bg-slate-100 text-slate-700 border border-slate-300'
              }
            `}
          >
            {examState.flagged.has(examState.currentQuestion)
              ? '⭐ Flagged for Review'
              : '☆ Flag for Review'}
          </button>

          {/* Navigation Buttons */}
          <div className="flex gap-3">
            <MobileButton
              fullWidth
              variant="secondary"
              onClick={handlePreviousQuestion}
              disabled={examState.currentQuestion === 1}
            >
              ← Previous
            </MobileButton>
            <MobileButton
              fullWidth
              variant="secondary"
              onClick={handleNextQuestion}
              disabled={examState.currentQuestion === questions.length}
            >
              Next →
            </MobileButton>
          </div>

          {/* Submit Button */}
          <MobileButton
            fullWidth
            variant="primary"
            onClick={handleSubmitExam}
            disabled={submitting}
            className="mt-6"
          >
            {submitting ? 'Submitting...' : 'Submit Exam'}
          </MobileButton>

          {/* Last Save Status */}
          {lastSaveTime && (
            <div className="text-xs text-slate-500 text-center p-2">
              ✓ Saved at {lastSaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
