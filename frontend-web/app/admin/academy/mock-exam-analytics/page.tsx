'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Users,
  BookOpen,
  TrendingUp,
  Target,
  Calendar,
  Zap,
  Loader2,
  Download,
  Filter,
} from 'lucide-react';

interface AdminAnalytics {
  total_learners: number;
  total_attempts: number;
  active_this_week: number;
  average_system_score: number;
  pass_rate: number;
  most_attempted_exam: string;
  exam_statistics: Array<{
    name: string;
    attempts: number;
    avg_score: number;
    pass_rate: number;
  }>;
  activity_data: Array<{
    date: string;
    attempts: number;
    unique_learners: number;
  }>;
  class_performance: Array<{
    class: string;
    avg_score: number;
    pass_rate: number;
    learners: number;
  }>;
  grade_distribution: Array<{
    grade: string;
    count: number;
  }>;
}

export default function AdminAnalyticsPage() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('week');

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/academy/admin/analytics?timeRange=${timeRange}`);
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const data = await response.json();
        setAnalytics(data.data);
      } catch (err) {
        console.error('Error fetching analytics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [timeRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-12">
          <p className="text-slate-600">No analytics data available</p>
        </div>
      </div>
    );
  }

  const gradeColors: Record<string, string> = {
    'A': '#10b981',
    'B': '#3b82f6',
    'C': '#f59e0b',
    'D': '#f97316',
    'F': '#ef4444',
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Mock Exam Analytics</h1>
            <p className="text-lg text-slate-600">System-wide performance and engagement metrics</p>
          </div>

          <div className="flex gap-4">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>

            <Button className="bg-blue-600 hover:bg-blue-700">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Total Learners */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Active Learners</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.total_learners}</p>
                  <p className="text-xs text-slate-500 mt-1">{analytics.active_this_week} this week</p>
                </div>
                <Users className="w-12 h-12 text-blue-100" />
              </div>
            </CardContent>
          </Card>

          {/* Total Attempts */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Total Attempts</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.total_attempts}</p>
                  <p className="text-xs text-slate-500 mt-1">Across all learners</p>
                </div>
                <BookOpen className="w-12 h-12 text-green-100" />
              </div>
            </CardContent>
          </Card>

          {/* System Average */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">System Average</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.average_system_score.toFixed(1)}%</p>
                  <p className="text-xs text-slate-500 mt-1">All exam types</p>
                </div>
                <TrendingUp className="w-12 h-12 text-purple-100" />
              </div>
            </CardContent>
          </Card>

          {/* Pass Rate */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Pass Rate</p>
                  <p className="text-3xl font-bold text-slate-900">{analytics.pass_rate.toFixed(0)}%</p>
                  <p className="text-xs text-slate-500 mt-1">60% threshold</p>
                </div>
                <Target className="w-12 h-12 text-yellow-100" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Activity Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Trend</CardTitle>
              <CardDescription>Exam attempts over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={analytics.activity_data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="attempts"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    name="Total Attempts"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="unique_learners"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    name="Unique Learners"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Grade Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Grade Distribution</CardTitle>
              <CardDescription>Breakdown by letter grade</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.grade_distribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ entry }: any) => `${entry.grade}: ${entry.count}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {analytics.grade_distribution.map((entry) => (
                      <Cell key={entry.grade} fill={gradeColors[entry.grade] || '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Performance by Class */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Performance by Class</CardTitle>
            <CardDescription>Average scores and pass rates</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.class_performance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="class" />
                <YAxis yAxisId="left" domain={[0, 100]} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="avg_score"
                  fill="#3b82f6"
                  name="Average Score"
                  radius={[8, 8, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="pass_rate"
                  fill="#10b981"
                  name="Pass Rate %"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Most Attempted Exams */}
        <Card>
          <CardHeader>
            <CardTitle>Most Popular Exams</CardTitle>
            <CardDescription>Top exams by number of attempts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.exam_statistics.slice(0, 8).map((exam, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <p className="font-medium text-slate-900">{exam.name}</p>
                      <Badge variant="outline">{exam.attempts} attempts</Badge>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-slate-600">Avg Score: <strong className="text-slate-900">{exam.avg_score.toFixed(1)}%</strong></span>
                      <span className="text-slate-600">Pass Rate: <strong className="text-slate-900">{exam.pass_rate.toFixed(0)}%</strong></span>
                    </div>
                  </div>

                  <div className="w-24 h-8 bg-gradient-to-r from-blue-100 to-blue-50 rounded flex items-center justify-center text-sm font-semibold text-blue-600">
                    {exam.attempts}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Insights */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                Key Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>• Engagement is highest on {analytics.active_this_week > analytics.total_learners / 2 ? 'weekdays' : 'weekends'}</p>
              <p>• Most learners score between {Math.floor(analytics.average_system_score) - 10}% and {Math.ceil(analytics.average_system_score) + 10}%</p>
              <p>• {analytics.pass_rate > 70 ? 'Strong overall performance' : 'Need more targeted support'} across the system</p>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-green-600" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>• Increase practice drills for lower-performing classes</p>
              <p>• Implement peer study groups for struggling learners</p>
              <p>• Celebrate high performers and share strategies system-wide</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
