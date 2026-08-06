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
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useBiometricSessionTimeout } from '@/hooks/useBiometric';
import { useBackgroundSync, useOfflineQueue, useSyncNotification } from '@/hooks/useBackgroundSync';
import { getExamDatabase } from '@/lib/db/examDatabase';
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

export default function OfflineExamPage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.templateId as string;
  const { isMobile } = useViewport();
  const network = useNetworkStatus();
  const { isSessionExpired, resetSession } = useBiometricSessionTimeout(20); // 20 min timeout
  const { syncStatus, itemsToSync, itemsSynced, manualSync } = useBackgroundSync();
  const { hasOfflineQueue, addToQueue, queueCount } = useOfflineQueue();
  const { notification, showNotification } = useSyncNotification();
  const contentRef = useRef<HTMLDivElement>(null);

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
  const [isOfflineMode, setIsOfflineMode] = useState(!network.isOnline);
  const [storageWarning, setStorageWarning] = useState(false);

  // Setup swipe navigation
  useSwipeGesture(contentRef, {
    onSwipeLeft: () => handleNextQuestion(),
    onSwipeRight: () => handlePreviousQuestion(),
    threshold: 50,
  });

  // Load exam (from network or cache)
  useEffect(() => {
    const loadExam = async () => {
      try {
        const db = await getExamDatabase();

        // Try to load from cache first
        const cachedTemplate = await db.getTemplate(templateId);
        if (cachedTemplate) {
          const mockQuestions: Question[] = Array.from({ length: 50 }, (_, i) => ({
            id: `q${i + 1}`,
            number: i + 1,
            text: `Question ${i + 1}: ${cachedTemplate.name}`,
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            type: 'multiple-choice',
          }));
          setQuestions(mockQuestions);

          // Try to fetch fresh copy if online
          if (network.isOnline) {
            try {
              const freshTemplate = await mockExamClient.getTemplate(templateId);
              await db.saveTemplate(freshTemplate);
            } catch (error) {
              console.warn('Failed to refresh template from network');
            }
          }
        } else if (network.isOnline) {
          // Fetch from network and cache
          const template = await mockExamClient.getTemplate(templateId);
          await db.saveTemplate(template);

          const mockQuestions: Question[] = Array.from({ length: 50 }, (_, i) => ({
            id: `q${i + 1}`,
            number: i + 1,
            text: `Question ${i + 1}: ${template.name}`,
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            type: 'multiple-choice',
          }));
          setQuestions(mockQuestions);
        } else {
          throw new Error('Exam not cached and no network connection');
        }

        // Load resume exam progress if exists
        const savedProgress = await db.getProgress(templateId);
        if (savedProgress) {
          setExamState({
            answers: savedProgress.answers,
            flagged: new Set(savedProgress.flagged),
            currentQuestion: savedProgress.currentQuestion,
          });
          setTimeRemaining(savedProgress.totalTime - savedProgress.timeSpent);
        }

        setLoading(false);
      } catch (error) {
        console.error('Failed to load exam:', error);
        showNotification('Exam failed to load', 'error');
        setLoading(false);
      }
    };

    loadExam();
  }, [templateId, network.isOnline]);

  // Monitor offline status
  useEffect(() => {
    setIsOfflineMode(!network.isOnline);
    if (network.isOnline) {
      showNotification('✓ Back online', 'success');
      manualSync(); // Auto-sync when coming online
    } else {
      showNotification('⚠ No internet connection', 'info', 5000);
    }
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

  // Auto-save to local DB
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      saveProgressToDatabase();
    }, 30000);
    return () => clearInterval(autoSaveInterval);
  }, [examState]);

  // Check storage quota
  useEffect(() => {
    const checkStorage = async () => {
      const db = await getExamDatabase();
      const { usage, quota } = await db.getStorageInfo();
      const usagePercent = (usage / quota) * 100;
      setStorageWarning(usagePercent > 80);
    };
    checkStorage();
  }, []);

  const currentQuestion = questions[examState.currentQuestion - 1];
  const answeredCount = Object.keys(examState.answers).length;
  const unansweredCount = questions.length - answeredCount;
  const flaggedCount = examState.flagged.size;
  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  const handleAnswerChange = useCallback((answer: string) => {
    resetSession(); // Reset timeout on activity
    setExamState((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        [prev.currentQuestion]: answer,
      },
    }));
  }, []);

  const handleFlagQuestion = useCallback(() => {
    resetSession();
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
    resetSession();
    setExamState((prev) => ({
      ...prev,
      currentQuestion: questionNum,
    }));
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, []);

  const handlePreviousQuestion = useCallback(() => {
    resetSession();
    setExamState((prev) => ({
      ...prev,
      currentQuestion: Math.max(1, prev.currentQuestion - 1),
    }));
  }, []);

  const handleNextQuestion = useCallback(() => {
    resetSession();
    setExamState((prev) => ({
      ...prev,
      currentQuestion: Math.min(questions.length, prev.currentQuestion + 1),
    }));
  }, []);

  const saveProgressToDatabase = async () => {
    try {
      const db = await getExamDatabase();
      await db.saveProgress({
        attemptId: templateId,
        templateId,
        userId: 'current-user', // Would be from auth context
        answers: examState.answers,
        flagged: Array.from(examState.flagged),
        currentQuestion: examState.currentQuestion,
        timeSpent: 5400 - timeRemaining,
        totalTime: 5400,
        startedAt: Date.now() - (5400 - timeRemaining) * 1000,
        lastSavedAt: Date.now(),
        syncStatus: network.isOnline ? 'synced' : 'pending',
      });
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  };

  const handleSubmitExam = async () => {
    if (isSessionExpired) {
      showNotification('Session expired. Please re-authenticate.', 'error', 5000);
      return;
    }

    setSubmitting(true);

    try {
      // Save to local DB first
      await saveProgressToDatabase();

      if (network.isOnline) {
        // Submit to server
        await mockExamClient.submitExam(templateId, {
          answers: examState.answers,
          timeSpent: 5400 - timeRemaining,
        });

        showNotification('✓ Exam submitted successfully', 'success');
        router.push(`/academy/mock-exams/${templateId}/results`);
      } else {
        // Queue for sync
        await addToQueue(templateId, 'submit_exam', {
          answers: examState.answers,
          timeSpent: 5400 - timeRemaining,
        });

        showNotification(
          '✓ Exam saved offline. Will sync when online.',
          'info',
          5000
        );

        // Still navigate to results (using cached data)
        router.push(`/academy/mock-exams/${templateId}/results`);
      }
    } catch (error) {
      console.error('Failed to submit exam:', error);
      showNotification('Failed to submit exam', 'error');
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
      {/* Sync Notification */}
      {notification && (
        <div
          className={`
            mb-4 p-3 rounded-lg border
            ${
              notification.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : notification.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
            }
          `}
        >
          <p className="text-sm">{notification.message}</p>
        </div>
      )}

      {/* Session Timeout Warning */}
      {isSessionExpired && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-red-900">
            Session Expired - Please re-authenticate to continue
          </p>
        </div>
      )}

      {/* Offline Mode Indicator */}
      {isOfflineMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-amber-600 font-bold">📵</span>
            <div className="flex-1 flex-col">
              <p className="text-sm font-medium text-amber-900">Offline Mode</p>
              <p className="text-xs text-amber-700">
                Answers saved locally. Will sync when you go online.
              </p>
              {queueCount > 0 && (
                <div className="mt-2 flex gap-2">
                  <p className="text-xs text-amber-700">
                    {queueCount} item{queueCount !== 1 ? 's' : ''} waiting to sync
                  </p>
                  <button
                    onClick={manualSync}
                    disabled={isOfflineMode}
                    className="text-xs text-amber-600 hover:text-amber-700 font-medium underline disabled:opacity-50"
                  >
                    Retry now
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Storage Warning */}
      {storageWarning && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-xs text-orange-700">
          Storage nearly full. Some features may be limited.
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

        {/* Question Content */}
        <div ref={contentRef} className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-900">
              Question {examState.currentQuestion} of {questions.length}
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mt-2">{currentQuestion.text}</h2>
          </div>

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
            disabled={submitting || isSessionExpired}
            className="mt-6"
          >
            {submitting ? 'Submitting...' : 'Submit Exam'}
          </MobileButton>
        </div>
      </div>
    </MobileLayout>
  );
}
