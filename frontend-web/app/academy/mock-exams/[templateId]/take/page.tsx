'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Clock, ChevronLeft, ChevronRight, Flag, FlagOff, Loader2 } from 'lucide-react';

interface Question {
  id: string;
  order: number;
  section: string;
  difficulty: string;
  time_sec: number;
}

interface ExamProgress {
  attempt_id: string;
  exam_code: string;
  template_name: string;
  progress: number;
  time_elapsed: number;
  time_remaining: number;
  total_questions: number;
  answered_count: number;
  flagged_count: number;
  questions: Question[];
  current_answers: Record<string, any>;
}

export default function ExamTakePage({ params }: { params: { templateId: string } }) {
  const router = useRouter();
  const [examState, setExamState] = useState<ExamProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<Set<string>>(new Set());
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Initialize exam
  useEffect(() => {
    const startExam = async () => {
      try {
        const response = await fetch('/api/academy/mock-exams/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: params.templateId }),
        });

        if (!response.ok) throw new Error('Failed to start exam');
        const data = await response.json();

        // Fetch exam progress
        const progressResponse = await fetch(
          `/api/academy/mock-exams/attempts/${data.data.id}`
        );
        if (!progressResponse.ok) throw new Error('Failed to load exam');
        const progressData = await progressResponse.json();

        setExamState(progressData.data);
        setAnswers(progressData.data.current_answers);
      } catch (err) {
        console.error('Error starting exam:', err);
      } finally {
        setLoading(false);
      }
    };

    startExam();
  }, [params.templateId]);

  // Auto-save progress every 30 seconds
  useEffect(() => {
    if (!examState?.attempt_id) return;

    const saveProgress = async () => {
      try {
        await fetch(`/api/academy/mock-exams/attempts/${examState.attempt_id}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers,
            flagged_questions: Array.from(flaggedQuestions),
          }),
        });
      } catch (err) {
        console.error('Error saving progress:', err);
      }
    };

    const timer = setInterval(saveProgress, 30000);
    return () => clearInterval(timer);
  }, [examState?.attempt_id, answers, flaggedQuestions]);

  const handleAnswerChange = (questionId: string, value: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const toggleFlagQuestion = (questionId: string) => {
    setFlaggedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/academy/mock-exams/attempts/${examState?.attempt_id}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers,
            flagged_questions: Array.from(flaggedQuestions),
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to submit exam');

      router.push(`/academy/mock-exams/${examState?.attempt_id}/results`);
    } catch (err) {
      console.error('Error submitting exam:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !examState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const question = examState.questions[currentQuestion];
  const isAnswered = !!answers[question?.id];
  const isFlagged = flaggedQuestions.has(question?.id);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Top Bar */}
      <div className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-bold text-slate-900">{examState.template_name}</h1>
            <p className="text-sm text-slate-600">{examState.exam_code}</p>
          </div>

          <div className="flex items-center gap-6">
            {/* Progress */}
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{examState.progress}%</div>
              <p className="text-xs text-slate-600">Complete</p>
            </div>

            {/* Timer */}
            <div className="flex items-center gap-2 bg-red-50 px-4 py-2 rounded-lg border border-red-200">
              <Clock className="w-5 h-5 text-red-600" />
              <div>
                <div className="font-bold text-red-600">{formatTime(examState.time_remaining)}</div>
                <p className="text-xs text-red-600">Remaining</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3">
            <Card className="mb-8">
              <CardContent className="p-8">
                {/* Question Header */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <Badge variant="outline" className="mb-3">
                        Question {currentQuestion + 1} of {examState.total_questions}
                      </Badge>
                      <h2 className="text-2xl font-bold text-slate-900">
                        Question in Section {question?.section}
                      </h2>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleFlagQuestion(question?.id)}
                      className={isFlagged ? 'text-yellow-600' : 'text-slate-400'}
                    >
                      {isFlagged ? (
                        <Flag className="w-5 h-5 fill-current" />
                      ) : (
                        <FlagOff className="w-5 h-5" />
                      )}
                    </Button>
                  </div>

                  <div className="flex gap-3">
                    <Badge variant="secondary">
                      Difficulty: {question?.difficulty}
                    </Badge>
                    <Badge variant="outline">
                      {question?.time_sec}s recommended
                    </Badge>
                  </div>
                </div>

                {/* Question Content Placeholder */}
                <div className="bg-slate-50 rounded-lg p-8 mb-8 border border-slate-200 min-h-[200px] flex items-center justify-center">
                  <p className="text-slate-600 text-center">
                    Question content would be rendered here. In production, this would display:
                    <br />
                    - Question text
                    <br />- Multiple choice options or text input
                    <br />- Media (images, diagrams, etc.)
                  </p>
                </div>

                {/* Answer Input */}
                <div className="mb-8">
                  <label className="block text-sm font-medium text-slate-700 mb-3">
                    Your Answer
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {['A', 'B', 'C', 'D'].map(option => (
                      <Button
                        key={option}
                        variant={answers[question?.id] === option ? 'default' : 'outline'}
                        className="w-12 h-12"
                        onClick={() => handleAnswerChange(question?.id, option)}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between items-center pt-8 border-t border-slate-200">
                  <Button
                    variant="outline"
                    onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
                    disabled={currentQuestion === 0}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Previous
                  </Button>

                  <div className="text-sm text-slate-600">
                    {examState.answered_count} of {examState.total_questions} answered
                  </div>

                  {currentQuestion < examState.total_questions - 1 ? (
                    <Button
                      onClick={() => setCurrentQuestion(currentQuestion + 1)}
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setShowSubmitDialog(true)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Submit Exam
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Question Navigator */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24">
              <CardContent className="p-6">
                <h3 className="font-semibold text-slate-900 mb-4">Questions</h3>
                <div className="grid grid-cols-5 gap-2 max-h-96 overflow-y-auto">
                  {examState.questions.map((q, idx) => (
                    <button
                      key={q.id}
                      onClick={() => setCurrentQuestion(idx)}
                      className={`w-10 h-10 rounded flex items-center justify-center text-sm font-medium transition-colors ${
                        idx === currentQuestion
                          ? 'bg-blue-600 text-white'
                          : answers[q.id]
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                      title={`Q${idx + 1}${flaggedQuestions.has(q.id) ? ' (Flagged)' : ''}`}
                    >
                      {flaggedQuestions.has(q.id) ? '🚩' : idx + 1}
                    </button>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-slate-200 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-100 rounded"></div>
                    <span className="text-slate-600">Answered: {examState.answered_count}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-yellow-100 rounded"></div>
                    <span className="text-slate-600">Flagged: {examState.flagged_count}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Submit Dialog */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Submit Exam?</AlertDialogTitle>
          <AlertDialogDescription>
            <div className="space-y-3">
              <p>You have answered <strong>{examState.answered_count}</strong> out of <strong>{examState.total_questions}</strong> questions.</p>
              <p>Once submitted, you cannot make changes to your answers.</p>
              <p className="text-sm text-slate-600">Are you sure you want to submit?</p>
            </div>
          </AlertDialogDescription>
          <div className="flex justify-end gap-3">
            <AlertDialogCancel>Continue</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Exam'
              )}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
