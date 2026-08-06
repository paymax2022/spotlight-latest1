'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Clock, BookOpen, TrendingUp } from 'lucide-react';

interface MockExamTemplate {
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

export default function MockExamsPage() {
  const [templates, setTemplates] = useState<MockExamTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (classFilter) params.append('class_id', classFilter);
        if (typeFilter) params.append('exam_type', typeFilter);

        const response = await fetch(`/api/academy/mock-exams/templates?${params}`);
        if (!response.ok) throw new Error('Failed to fetch templates');

        const data = await response.json();
        setTemplates(data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [classFilter, typeFilter]);

  const getExamTypeBadge = (type: string) => {
    const variants: Record<string, string> = {
      'class_mock': 'default',
      'subject_mock': 'secondary',
      'practice_drill': 'outline',
    };
    const labels: Record<string, string> = {
      'class_mock': 'Full Exam',
      'subject_mock': 'Subject Focus',
      'practice_drill': 'Practice Drill',
    };
    return <Badge variant={variants[type] || 'default'}>{labels[type] || type}</Badge>;
  };

  const getDifficultyBreakdown = (dist: MockExamTemplate['difficulty_distribution']) => {
    return (
      <div className="flex gap-4 text-sm">
        <span className="text-green-600">Easy: {dist.easy}%</span>
        <span className="text-yellow-600">Medium: {dist.medium}%</span>
        <span className="text-red-600">Hard: {dist.hard}%</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Mock Exam Papers</h1>
          <p className="text-lg text-slate-600">
            Practice with realistic exam papers and track your progress
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8 border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Class Level
              </label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All classes</SelectItem>
                  <SelectItem value="P1">Primary 1</SelectItem>
                  <SelectItem value="P4">Primary 4</SelectItem>
                  <SelectItem value="P6">Primary 6</SelectItem>
                  <SelectItem value="JSS1">JSS 1</SelectItem>
                  <SelectItem value="JSS2">JSS 2</SelectItem>
                  <SelectItem value="JSS3">JSS 3</SelectItem>
                  <SelectItem value="SSS1">SSS 1</SelectItem>
                  <SelectItem value="SSS2">SSS 2</SelectItem>
                  <SelectItem value="SSS3">SSS 3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Exam Type
              </label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  <SelectItem value="class_mock">Full Exam</SelectItem>
                  <SelectItem value="subject_mock">Subject Focus</SelectItem>
                  <SelectItem value="practice_drill">Practice Drill</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-8">
            <p className="font-medium">Error loading exam templates</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Templates Grid */}
        {!loading && templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <Card key={template.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    {getExamTypeBadge(template.exam_type)}
                  </div>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Stats */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-slate-600">
                      <BookOpen className="w-4 h-4" />
                      <span>{template.total_questions} questions</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4" />
                      <span>{template.total_minutes} minutes</span>
                    </div>
                  </div>

                  {/* Difficulty Breakdown */}
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-600 mb-2">Difficulty Distribution</p>
                    {getDifficultyBreakdown(template.difficulty_distribution)}
                  </div>

                  {/* Action Button */}
                  <Link href={`/academy/mock-exams/${template.id}/start`}>
                    <Button className="w-full bg-blue-600 hover:bg-blue-700">
                      Start Exam
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && templates.length === 0 && (
          <div className="text-center py-12">
            <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">No exam templates available for the selected filters</p>
            <Button
              variant="outline"
              onClick={() => {
                setClassFilter('');
                setTypeFilter('');
              }}
              className="mt-4"
            >
              Clear Filters
            </Button>
          </div>
        )}

        {/* Quick Stats */}
        {!loading && templates.length > 0 && (
          <div className="mt-12 bg-blue-50 rounded-lg p-8 border border-blue-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 mb-2">{templates.length}</div>
                <p className="text-slate-600">Available Exams</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 mb-2">
                  {templates.reduce((sum, t) => sum + t.total_questions, 0)}
                </div>
                <p className="text-slate-600">Total Questions</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 mb-2">
                  {Math.round(templates.reduce((sum, t) => sum + t.total_minutes, 0) / templates.length)}
                </div>
                <p className="text-slate-600">Avg. Duration (min)</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
