'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

type Participant = {
  id: string;
  name: string;
  email: string;
  competition: string;
  status: 'pending' | 'qualified' | 'disqualified' | 'withdrawn';
  submissionDate: string;
  score?: number;
};

const MOCK_PARTICIPANTS: Participant[] = [
  { id: '1', name: 'Chioma Okonkwo', email: 'chioma@example.com', competition: 'Open Mic Q3', status: 'qualified', submissionDate: '2024-07-15', score: 87 },
  { id: '2', name: 'Tunde Adeyemi', email: 'tunde@example.com', competition: 'Open Mic Q3', status: 'pending', submissionDate: '2024-07-18' },
  { id: '3', name: 'Amara Ejiro', email: 'amara@example.com', competition: 'Reality TV', status: 'qualified', submissionDate: '2024-06-20', score: 92 },
  { id: '4', name: 'Nonso Ifeanyi', email: 'nonso@example.com', competition: 'Open Mic Q3', status: 'disqualified', submissionDate: '2024-07-12' },
];

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'pending': 'secondary',
  'qualified': 'default',
  'disqualified': 'destructive',
  'withdrawn': 'outline',
};

export default function ParticipantsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return MOCK_PARTICIPANTS.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase());
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [search, filterStatus]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Participants & Entries</h1>
        <p className="text-gray-600 mt-2">Review submissions, manage qualifications, and handle participant issues.</p>
      </div>

      {/* Filters Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white cursor-pointer text-gray-900"
            >
              <option value="">All Status</option>
              <option value="pending">Pending Review</option>
              <option value="qualified">Qualified</option>
              <option value="disqualified">Disqualified</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Participants Table Card */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Competition</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Score</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Submitted</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    No participants found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{p.email}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{p.competition}</td>
                    <td className="px-6 py-4 text-sm">
                      <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{p.score ? `${p.score}%` : '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(p.submissionDate).toLocaleDateString('en-NG')}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedParticipant(p)}
                        >
                          View Entry
                        </Button>
                        {p.status === 'pending' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setReviewingId(p.id)}
                          >
                            Review
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t text-sm text-gray-600 bg-gray-50">
          Showing {filtered.length} of {MOCK_PARTICIPANTS.length} participants
        </div>
      </Card>

      {/* Entry Details Modal */}
      {selectedParticipant && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-1000 p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Entry Details</CardTitle>
              <button
                onClick={() => setSelectedParticipant(null)}
                className="text-2xl text-gray-400 hover:text-gray-600 leading-none"
              >
                ✕
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <span className="text-gray-600 text-sm">Name:</span>
                <p className="font-medium text-gray-900">{selectedParticipant.name}</p>
              </div>
              <div>
                <span className="text-gray-600 text-sm">Email:</span>
                <p className="text-gray-700">{selectedParticipant.email}</p>
              </div>
              <div>
                <span className="text-gray-600 text-sm">Competition:</span>
                <p className="text-gray-700">{selectedParticipant.competition}</p>
              </div>
              <div>
                <span className="text-gray-600 text-sm">Status:</span>
                <div className="mt-1">
                  <Badge variant={statusVariant[selectedParticipant.status]}>
                    {selectedParticipant.status}
                  </Badge>
                </div>
              </div>
              {selectedParticipant.score && (
                <div>
                  <span className="text-gray-600 text-sm">Score:</span>
                  <p className="font-medium text-gray-900">{selectedParticipant.score}%</p>
                </div>
              )}
              <div>
                <span className="text-gray-600 text-sm">Submitted:</span>
                <p className="text-gray-700">
                  {new Date(selectedParticipant.submissionDate).toLocaleDateString('en-NG')}
                </p>
              </div>
              <div className="mt-4 p-4 bg-gray-100 rounded-md text-gray-600 text-sm">
                Entry submission content would display here...
              </div>
              <div className="mt-6 flex gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setSelectedParticipant(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Review Modal */}
      {reviewingId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-1000 p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Review Entry</CardTitle>
              <button
                onClick={() => setReviewingId(null)}
                className="text-2xl text-gray-400 hover:text-gray-600 leading-none"
              >
                ✕
              </button>
            </CardHeader>
            <CardContent>
              <div className="mb-6 p-4 bg-gray-100 rounded-md">
                <p className="font-medium text-gray-900">Entry Content</p>
                <p className="text-gray-600 text-sm mt-1">
                  Review the submission and make your decision
                </p>
              </div>
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="primary"
                  onClick={() => {
                    setReviewingId(null);
                    alert('Entry qualified!');
                  }}
                >
                  Qualify
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setReviewingId(null);
                    alert('Entry disqualified!');
                  }}
                >
                  Disqualify
                </Button>
                <Button variant="outline" onClick={() => setReviewingId(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
