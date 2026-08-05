'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

type Benefit = {
  id: string;
  name: string;
  type: 'cash' | 'non-cash';
  description: string;
};

type Award = {
  position: number;
  title: string;
  amount?: number;
  benefits: Benefit[];
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
    currency: 'NGN',
  });
  const [awards, setAwards] = useState<Award[]>([
    { position: 1, title: 'Gold Medal', amount: 0, benefits: [] },
    { position: 2, title: 'Silver Medal', amount: 0, benefits: [] },
    { position: 3, title: 'Bronze Medal', amount: 0, benefits: [] },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newBenefitByPosition, setNewBenefitByPosition] = useState<Record<number, Benefit>>({
    1: { id: '', name: '', type: 'non-cash', description: '' },
    2: { id: '', name: '', type: 'non-cash', description: '' },
    3: { id: '', name: '', type: 'non-cash', description: '' },
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addBenefitToPosition = (position: number) => {
    const benefit = newBenefitByPosition[position];
    if (!benefit.name.trim() || !benefit.description.trim()) {
      setError('Benefit name and description are required');
      return;
    }
    setAwards(awards.map(a =>
      a.position === position
        ? { ...a, benefits: [...a.benefits, { ...benefit, id: `benefit-${Date.now()}` }] }
        : a
    ));
    setNewBenefitByPosition({
      ...newBenefitByPosition,
      [position]: { id: '', name: '', type: 'non-cash', description: '' }
    });
  };

  const removeBenefitFromPosition = (position: number, benefitId: string) => {
    setAwards(awards.map(a =>
      a.position === position
        ? { ...a, benefits: a.benefits.filter(b => b.id !== benefitId) }
        : a
    ));
  };

  const updateAward = (position: number, field: string, value: string | number) => {
    setAwards(awards.map(a => a.position === position ? { ...a, [field]: value } : a));
  };

  const addAwardPosition = () => {
    const maxPosition = Math.max(...awards.map(a => a.position), 0);
    setAwards([...awards, { position: maxPosition + 1, title: '', amount: 0, benefits: [] }]);
    setNewBenefitByPosition({
      ...newBenefitByPosition,
      [maxPosition + 1]: { id: '', name: '', type: 'non-cash', description: '' }
    });
  };

  const calculateTotalPrizePool = () => {
    return awards.reduce((sum, award) => sum + (award.amount || 0), 0);
  };

  const formatCurrency = (value: number, currency: string = formData.currency) => {
    const currencyMap: Record<string, string> = {
      'NGN': 'en-NG',
      'USD': 'en-US',
      'EUR': 'de-DE',
      'GBP': 'en-GB',
    };
    return new Intl.NumberFormat(currencyMap[currency] || 'en-NG', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
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
        totalPrizePool: calculateTotalPrizePool(),
        banner: formData.banner,
        currency: formData.currency,
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
                Total Prize Pool - Calculated from awards
              </label>
              <div style={{ padding: '0.75rem', background: colors.inputBorder + '20', borderRadius: '0.375rem', fontSize: '1rem', fontWeight: 600, color: colors.success }}>
                {formatCurrency(calculateTotalPrizePool())}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
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
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                  Currency
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => handleChange('currency', e.target.value)}
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
                  <option value="NGN">₦ NGN</option>
                  <option value="USD">$ USD</option>
                  <option value="EUR">€ EUR</option>
                  <option value="GBP">£ GBP</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Position Awards & Benefits">
          <div style={{ display: 'grid', gap: '1.5rem', marginTop: '1rem' }}>
            {awards.map((award) => (
              <div key={award.position} style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
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

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '1rem', marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '12px', fontWeight: 600, color: colors.text, marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                    Benefits & Perks for Position {award.position}
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr 0.8fr', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                        Name
                      </label>
                      <Input
                        placeholder="e.g., Cash Bonus"
                        value={newBenefitByPosition[award.position]?.name || ''}
                        onChange={(e) => setNewBenefitByPosition({
                          ...newBenefitByPosition,
                          [award.position]: { ...newBenefitByPosition[award.position], name: e.target.value }
                        })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                        Type
                      </label>
                      <select
                        value={newBenefitByPosition[award.position]?.type || 'non-cash'}
                        onChange={(e) => setNewBenefitByPosition({
                          ...newBenefitByPosition,
                          [award.position]: { ...newBenefitByPosition[award.position], type: e.target.value as 'cash' | 'non-cash' }
                        })}
                        style={{
                          width: '100%',
                          padding: '0.35rem 0.45rem',
                          border: `1px solid ${colors.inputBorder}`,
                          borderRadius: '0.375rem',
                          fontSize: '0.8rem',
                          background: colors.card,
                          cursor: 'pointer',
                          color: colors.text
                        }}
                      >
                        <option value="non-cash">Non-Cash</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                        Description
                      </label>
                      <Input
                        placeholder="e.g., Recognition certificate"
                        value={newBenefitByPosition[award.position]?.description || ''}
                        onChange={(e) => setNewBenefitByPosition({
                          ...newBenefitByPosition,
                          [award.position]: { ...newBenefitByPosition[award.position], description: e.target.value }
                        })}
                      />
                    </div>
                    <Button variant="primary" onClick={() => addBenefitToPosition(award.position)} style={{ marginBottom: 0, padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}>
                      Add
                    </Button>
                  </div>

                  {award.benefits.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      {award.benefits.map((benefit) => (
                        <div key={benefit.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: colors.card, borderRadius: '0.25rem', marginBottom: '0.4rem', fontSize: '0.8rem' }}>
                          <span>{benefit.type === 'cash' ? '💰' : '🎁'} <strong>{benefit.name}</strong> - {benefit.description}</span>
                          <button
                            type="button"
                            onClick={() => removeBenefitFromPosition(award.position, benefit.id)}
                            style={{
                              padding: '0.2rem 0.4rem',
                              background: colors.danger,
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.25rem',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
