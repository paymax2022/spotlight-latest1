'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

type Benefit = {
  id: string;
  name: string;
  type: 'cash' | 'non-cash';
  value?: string;
  description: string;
};

type Award = {
  position: number;
  title: string;
  amount?: number;
};

export default function CreateCompetitionPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    title: '',
    type: 'open-mic',
    status: 'draft',
    startDate: '',
    endDate: '',
    prizePool: '',
    banner: '',
  });
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [newBenefit, setNewBenefit] = useState<Benefit>({
    id: '',
    name: '',
    type: 'non-cash',
    value: '',
    description: '',
  });
  const [awards, setAwards] = useState<Award[]>([
    { position: 1, title: 'Gold Medal' },
    { position: 2, title: 'Silver Medal' },
    { position: 3, title: 'Bronze Medal' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addBenefit = () => {
    if (!newBenefit.name.trim() || !newBenefit.description.trim()) {
      setError('Benefit name and description are required');
      return;
    }
    setBenefits([...benefits, { ...newBenefit, id: `benefit-${Date.now()}` }]);
    setNewBenefit({ id: '', name: '', type: 'non-cash', value: '', description: '' });
  };

  const removeBenefit = (id: string) => {
    setBenefits(benefits.filter(b => b.id !== id));
  };

  const updateAward = (position: number, field: string, value: string | number) => {
    setAwards(awards.map(a => a.position === position ? { ...a, [field]: value } : a));
  };

  const addAwardPosition = () => {
    const maxPosition = Math.max(...awards.map(a => a.position), 0);
    setAwards([...awards, { position: maxPosition + 1, title: '' }]);
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
      await new Promise(resolve => setTimeout(resolve, 500));

      const newCompetition = {
        id: `comp-${Date.now()}`,
        title: formData.title.trim(),
        type: formData.type as 'open-mic' | 'reality-tv' | 'multi-skill' | 'other',
        status: formData.status as 'draft' | 'upcoming' | 'active' | 'ended',
        startDate: formData.startDate,
        endDate: formData.endDate,
        participantCount: 0,
        totalPrizePool: parseInt(formData.prizePool) || 0,
        banner: formData.banner,
        benefits,
        awards,
      };

      let competitions: any[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('competitions');
        if (stored) {
          try {
            competitions = JSON.parse(stored);
          } catch {
            competitions = [];
          }
        }
      }

      competitions.push(newCompetition);
      if (typeof window !== 'undefined') {
        localStorage.setItem('competitions', JSON.stringify(competitions));
      }

      console.log('Created competition:', newCompetition);
      router.push('/admin/competitions/list');
    } catch (err) {
      setError('Failed to create competition');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Create Competition"
        subtitle="Set up a new competition with banners, benefits, and recognition awards."
      />

      <Link href="/admin/competitions/list" style={{ marginBottom: '1rem', display: 'block', color: colors.primary, textDecoration: 'none', fontSize: '14px' }}>
        ← Back to Competitions
      </Link>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <Card title="Competition Details">
          <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                Banner URL
              </label>
              <Input
                type="url"
                placeholder="https://example.com/banner.jpg"
                value={formData.banner}
                onChange={(e) => handleChange('banner', e.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card title="Benefits & Perks">
          <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                  Benefit Name
                </label>
                <Input
                  placeholder="e.g., Cash Prize"
                  value={newBenefit.name}
                  onChange={(e) => setNewBenefit({ ...newBenefit, name: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                  Type
                </label>
                <select
                  value={newBenefit.type}
                  onChange={(e) => setNewBenefit({ ...newBenefit, type: e.target.value as 'cash' | 'non-cash' })}
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
                  <option value="non-cash">Non-Cash</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <Button variant="primary" onClick={addBenefit} style={{ marginBottom: 0 }}>
                Add
              </Button>
            </div>

            <div>
              <Input
                placeholder="e.g., Guaranteed payment of ₦100,000"
                value={newBenefit.description}
                onChange={(e) => setNewBenefit({ ...newBenefit, description: e.target.value })}
              />
            </div>

            {benefits.length > 0 && (
              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '1rem' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, marginBottom: '0.5rem' }}>
                  Added Benefits:
                </h4>
                {benefits.map((benefit) => (
                  <div key={benefit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: colors.inputBorder + '20', borderRadius: '0.375rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: colors.text }}>{benefit.name}</div>
                      <div style={{ color: colors.muted, fontSize: '0.8rem' }}>{benefit.type === 'cash' ? '💰 Cash' : '🎁 Non-Cash'} - {benefit.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBenefit(benefit.id)}
                      style={{
                        padding: '0.3rem 0.6rem',
                        background: colors.danger,
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.375rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="Recognition Awards (Position-Based)">
          <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
            {awards.map((award) => (
              <div key={award.position} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '0.75rem', alignItems: 'center', padding: '0.75rem', background: colors.inputBorder + '20', borderRadius: '0.375rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.3rem', color: colors.text }}>
                    Position {award.position}
                  </label>
                </div>
                <div>
                  <Input
                    placeholder="e.g., Gold Medal, Champion"
                    value={award.title}
                    onChange={(e) => updateAward(award.position, 'title', e.target.value)}
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    placeholder="Prize (₦)"
                    value={award.amount || ''}
                    onChange={(e) => updateAward(award.position, 'amount', e.target.value ? parseInt(e.target.value) : 0)}
                  />
                </div>
              </div>
            ))}
            <Button variant="outline" type="button" onClick={addAwardPosition}>
              + Add Another Position
            </Button>
          </div>
        </Card>

        {error && (
          <div style={{ padding: '0.75rem', background: colors.danger + '20', border: `1px solid ${colors.danger}`, borderRadius: '0.375rem', color: colors.danger, fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Competition'}
          </Button>
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
