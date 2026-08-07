'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Download, Share2, Award, TrendingUp, Loader2, ArrowLeft } from 'lucide-react';

interface ExamResult {
  id: string;
  template_id: string;
  score: number;
  score_percent: number;
  grade: string;
  status: string;
  total_time: number;
  performance: {
    correct_answers: number;
    total_answered: number;
    unanswered: number;
  };
  by_section?: Record<string, any>;
  submitted_at: string;
  graded_at?: string;
}

export default function ResultsPage({ params }: { params: { attemptId: string } }) {
  const [result, setResult] = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const response = await fetch(
          `/api/academy/mock-exams/results/${params.attemptId}`
        );
        if (!response.ok) throw new Error('Failed to fetch results');
        const data = await response.json();
        setResult(data.data);
      } catch (err) {
        console.error('Error fetching results:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [params.attemptId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">No results found</p>
          <Link href="/academy/mock-exams">
            <Button variant="outline">Back to Exams</Button>
          </Link>
        </div>
      </div>
    );
  }

  const getGradeColor = (grade: string) => {
    const colors: Record<string, string> = {
      'A': 'text-green-600',
      'B': 'text-blue-600',
      'C': 'text-yellow-600',
      'D': 'text-orange-600',
      'F': 'text-red-600',
    };
    return colors[grade] || 'text-slate-600';
  };

  const getGradeBgColor = (grade: string) => {
    const colors: Record<string, string> = {
      'A': 'bg-green-100',
      'B': 'bg-blue-100',
      'C': 'bg-yellow-100',
      'D': 'bg-orange-100',
      'F': 'bg-red-100',
    };
    return colors[grade] || 'bg-slate-100';
  };

  const performanceData = [
    { name: 'Correct', value: result.performance.correct_answers, fill: '#10b981' },
    { name: 'Incorrect', value: result.performance.total_answered - result.performance.correct_answers, fill: '#ef4444' },
    { name: 'Unanswered', value: result.performance.unanswered, fill: '#9ca3af' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="container mx-auto px-4 py-12">
        {/* Back Button */}
        <Link href="/academy/mock-exams" className="mb-8 inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
          <ArrowLeft className="w-4 h-4" />
          Back to Exams
        </Link>

        {/* Results Header */}
        <div className={`rounded-lg p-8 mb-8 text-white ${result.grade === 'A' ? 'bg-gradient-to-r from-green-600 to-emerald-600' : result.grade === 'F' ? 'bg-gradient-to-r from-red-600 to-rose-600' : 'bg-gradient-to-r from-blue-600 to-cyan-600'}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold mb-2">Exam Completed!</h1>
              <p className="text-white/90">Your performance has been recorded</p>
            </div>
            <Award className="w-16 h-16 opacity-30" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Score */}
            <div>
              <p className="text-white/80 text-sm mb-1">Your Score</p>
              <div className="text-4xl font-bold">{result.score_percent.toFixed(1)}%</div>
              <p className="text-white/80 text-sm mt-1">{result.score} / {result.score + (result.performance.total_answered - result.performance.correct_answers)} points</p>
            </div>

            {/* Grade */}
            <div>
              <p className="text-white/80 text-sm mb-1">Grade</p>
              <div className={`text-5xl font-bold ${getGradeColor(result.grade)}`}>
                {result.grade}
              </div>
            </div>

            {/* Time */}
            <div>
              <p className="text-white/80 text-sm mb-1">Time Taken</p>
              <div className="text-2xl font-bold">
                {Math.floor(result.total_time / 60)}m {result.total_time % 60}s
              </div>
            </div>

            {/* Accuracy */}
            <div>
              <p className="text-white/80 text-sm mb-1">Accuracy</p>
              <div className="text-4xl font-bold">
                {Math.round((result.performance.correct_answers / result.performance.total_answered) * 100)}%
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Performance Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Breakdown</CardTitle>
              <CardDescription>Your answers distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={performanceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {performanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-6 space-y-2">
                {performanceData.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }}></div>
                      <span className="text-sm text-slate-600">{item.name}</span>
                    </div>
                    <span className="font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Score Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Score Analysis</CardTitle>
              <CardDescription>How you performed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Overall Score</label>
                  <span className="text-sm font-semibold text-slate-900">{result.score_percent.toFixed(1)}%</span>
                </div>
                <Progress value={result.score_percent} className="h-3" />
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Passing Score (60%)</label>
                  <span className={`text-sm font-semibold ${result.score_percent >= 60 ? 'text-green-600' : 'text-red-600'}`}>
                    {result.score_percent >= 60 ? '✓ Passed' : '✗ Failed'}
                  </span>
                </div>
                <Progress value={Math.min(result.score_percent, 100)} className="h-3" />
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-600 mb-2">Performance Metrics</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Questions Answered</span>
                    <span className="font-semibold">{result.performance.total_answered}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Correct Answers</span>
                    <span className="font-semibold text-green-600">{result.performance.correct_answers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Unanswered</span>
                    <span className="font-semibold text-yellow-600">{result.performance.unanswered}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                <Share2 className="w-4 h-4 mr-2" />
                Share Results
              </Button>
              <Button variant="outline" className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                Download Report
              </Button>
              <Link href="/academy/mock-exams" className="flex-1">
                <Button variant="outline" className="w-full">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Try Another Exam
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle>Next Steps</CardTitle>
            <CardDescription>Improve your performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {result.score_percent < 60 ? (
                <>
                  <li className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold">1</div>
                    <div>
                      <p className="font-medium text-slate-900">Review the Concepts</p>
                      <p className="text-sm text-slate-600">Focus on the topics where you scored lower</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold">2</div>
                    <div>
                      <p className="font-medium text-slate-900">Practice More Questions</p>
                      <p className="text-sm text-slate-600">Try our practice drills for weak areas</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold">3</div>
                    <div>
                      <p className="font-medium text-slate-900">Retake This Exam</p>
                      <p className="text-sm text-slate-600">A different variant to test your improvement</p>
                    </div>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold">✓</div>
                    <div>
                      <p className="font-medium text-slate-900">Excellent Performance!</p>
                      <p className="text-sm text-slate-600">You've demonstrated strong understanding of the material</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 text-sm font-semibold">→</div>
                    <div>
                      <p className="font-medium text-slate-900">Move to Advanced Topics</p>
                      <p className="text-sm text-slate-600">Try exams from higher difficulty levels</p>
                    </div>
                  </li>
                </>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
