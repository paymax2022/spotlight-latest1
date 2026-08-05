'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function CreateCompetitionPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    title: '',
    type: 'open-mic',
    status: 'draft',
    startDate: '',
    endDate: '',
    prizePool: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setError('Competition title is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Create new competition with unique ID
      const newCompetition = {
        id: `comp-${Date.now()}`,
        title: formData.title.trim(),
        type: formData.type as 'open-mic' | 'reality-tv' | 'multi-skill' | 'other',
        status: formData.status as 'draft' | 'upcoming' | 'active' | 'ended',
        startDate: formData.startDate,
        endDate: formData.endDate,
        participantCount: 0,
        totalPrizePool: parseInt(formData.prizePool) || 0,
      };

      // Load existing competitions from localStorage or use defaults
      let competitions: any[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('competitions');
        if (stored) {
          try {
            competitions = JSON.parse(stored);
          } catch {
            // If corrupted, start fresh
            competitions = [];
          }
        }
      }

      // Add new competition and save
      competitions.push(newCompetition);
      if (typeof window !== 'undefined') {
        localStorage.setItem('competitions', JSON.stringify(competitions));
      }

      console.log('Created competition:', newCompetition);
      // Redirect back to list
      router.push('/admin/competitions/list');
    } catch (err) {
      setError('Failed to create competition');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Create Competition"
        subtitle="Set up a new competition or contest."
      />

      <Link href="/admin/competitions/list" style={{ marginBottom: '1rem', display: 'block', color: colors.primary, textDecoration: 'none', fontSize: '14px' }}>
        ← Back to Competitions
      </Link>

      <Card title="Competition Details" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
              Title *
            </label>
            <Input
              placeholder="e.g., Open Mic Q4 2024"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
              Type
            </label>
            <select
              value={formData.type}
              onChange={(e) => handleChange('type', e.target.value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.55rem',
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: '0.375rem',
                fontSize: '0.85rem',
                background: colors.card,
                cursor: 'pointer',
                color: colors.text
              }}
            >
              <option value="open-mic">Open Mic</option>
              <option value="reality-tv">Reality TV</option>
              <option value="multi-skill">Multi-Skill</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.55rem',
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: '0.375rem',
                fontSize: '0.85rem',
                background: colors.card,
                cursor: 'pointer',
                color: colors.text
              }}
            >
              <option value="draft">Draft</option>
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                Start Date
              </label>
              <Input
                type="date"
                value={formData.startDate}
                onChange={(e) => handleChange('startDate', e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                End Date
              </label>
              <Input
                type="date"
                value={formData.endDate}
                onChange={(e) => handleChange('endDate', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
              Prize Pool (₦)
            </label>
            <Input
              type="number"
              placeholder="e.g., 500000"
              value={formData.prizePool}
              onChange={(e) => handleChange('prizePool', e.target.value)}
            />
          </div>

          {error && <p style={{ color: colors.danger, fontSize: '13px', margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Creating...' : 'Create Competition'}
            </Button>
            <Button variant="outline" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
