'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
  ScatterChart,
  Scatter,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Target,
  Calendar,
  Award,
  AlertCircle,
  Loader2,
  Download,
} from 'lucide-react';

interface ExamAttempt {
  id: string;
  template_id: string;
  template_name: string;
  exam_type: string;
  score_percent: number;
  grade: string;
  total_time: number;
  attempted_at: string;
  status: string;
}

interface AnalyticsData {
  total_attempts: number;
  average_score: number;
  best_score: number;
  worst_score: number;
  pass_rate: number;
  preferred_exam_type: string;
  attempts: ExamAttempt[];
  trend_data: Array<{ date: string; score: number; average: number }>;
  subject_performance: Array<{ subject: string; average: number; attempts: number }>;
  weak_areas: Array<{ topic: string; accuracy: number }>;
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/academy/mock-exams/analytics');
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const data = await response.json();
        setAnalytics(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
            <p className="font-medium">Error loading analytics</p>
            <p className="text-sm">{error || 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  const getGradeColor = (grade: string) => {
    const colors: Record<string, string> = {
      'A': '#10b981',
      'B': '#3b82f6',
      'C': '#f59e0b',
      'D': '#f97316',
      'F': '#ef4444',
    };
    return colors[grade] || '#6b7280';
  };

  const getTrendDirection = (current: number, previous: number) => {
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'flat';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">My Learning Analytics</h1>
          <p className="text-lg text-slate-600">
            Track your progress and identify areas for improvement
          </p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Total Attempts */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Total Attempts</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.total_attempts}</p>
                </div>
                <Calendar className="w-12 h-12 text-blue-100" />
              </div>
            </CardContent>
          </Card>

          {/* Average Score */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Average Score</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.average_score.toFixed(1)}%</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {analytics.average_score >= 70 ? '📈 Improving' : '📉 Needs work'}
                  </p>
                </div>
                <TrendingUp className="w-12 h-12 text-green-100" />
              </div>
            </CardContent>
          </Card>

          {/* Best Score */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Best Score</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.best_score.toFixed(1)}%</p>
                  <Badge className="mt-2">{analytics.best_score >= 80 ? 'Excellent' : 'Good'}</Badge>
                </div>
                <Award className="w-12 h-12 text-yellow-100" />
              </div>
            </CardContent>
          </Card>

          {/* Pass Rate */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Pass Rate</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.pass_rate.toFixed(0)}%</p>
                  <p className="text-xs text-slate-500 mt-1">{Math.round(analytics.total_attempts * analytics.pass_rate / 100)} passed</p>
                </div>
                <Target className="w-12 h-12 text-purple-100" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Section */}
        <Tabs defaultValue="trends" className="space-y-8">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Trends Tab */}
          <TabsContent value="trends" className="space-y-8">
            {/* Score Trend */}
            <Card>
              <CardHeader>
                <CardTitle>Score Trends</CardTitle>
                <CardDescription>Your performance over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.trend_data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      name="Your Score"
                      dot={{ fill: '#3b82f6', r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="average"
                      stroke="#9ca3af"
                      strokeDasharray="5 5"
                      strokeWidth={1}
                      name="Class Average"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Subject Performance */}
            <Card>
              <CardHeader>
                <CardTitle>Subject Performance</CardTitle>
                <CardDescription>Average score by subject</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.subject_performance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="subject" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="average" fill="#3b82f6" name="Average Score" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="attempts" fill="#e5e7eb" name="Attempts" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-8">
            {/* Weak Areas */}
            <Card>
              <CardHeader>
                <CardTitle>Areas for Improvement</CardTitle>
                <CardDescription>Topics where you need more practice</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analytics.weak_areas.length > 0 ? (
                    analytics.weak_areas.map((area, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-yellow-600" />
                          <div>
                            <p className="font-medium text-slate-900">{area.topic}</p>
                            <p className="text-sm text-slate-600">Accuracy: {area.accuracy.toFixed(1)}%</p>
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          Practice
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-slate-600">No weak areas identified. Keep up the great work!</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Study Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle>Personalized Recommendations</CardTitle>
                <CardDescription>Based on your performance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex gap-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <Zap className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900">Focus on Problem-Solving</p>
                      <p className="text-sm text-blue-800">Your accuracy on higher-difficulty questions can be improved with targeted practice</p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 bg-green-50 rounded-lg border border-green-200">
                    <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-900">Maintain Momentum</p>
                      <p className="text-sm text-green-800">Your performance is improving. Take an exam every other day to consolidate learning</p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <Target className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-purple-900">Set a Goal</p>
                      <p className="text-sm text-purple-800">Aim for 80% or higher on your next 5 exams to demonstrate mastery</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Exam Attempts</CardTitle>
                <CardDescription>Your last 10 exams</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 font-medium text-slate-700">Exam</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-700">Type</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-700">Score</th>
                        <th className="text-center py-3 px-4 font-medium text-slate-700">Grade</th>
                        <th className="text-left py-3 px-4 font-medium text-slate-700">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.attempts.map((attempt) => (
                        <tr key={attempt.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">{attempt.template_name}</td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="text-xs">
                              {attempt.exam_type === 'class_mock' ? 'Full' : attempt.exam_type === 'subject_mock' ? 'Subject' : 'Drill'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-900">
                            {attempt.score_percent.toFixed(1)}%
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                              style={{ backgroundColor: getGradeColor(attempt.grade) }}
                            >
                              {attempt.grade}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {new Date(attempt.attempted_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Export Section */}
        <Card className="mt-8">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Download Your Report</p>
                <p className="text-sm text-slate-600">Get a detailed PDF report of your learning analytics</p>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
