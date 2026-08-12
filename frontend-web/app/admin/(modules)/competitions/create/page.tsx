'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

type Beat = {
  id: string;
  title: string;
  genre: string;
  duration: string;
  fileUrl?: string;
  uploadDate: string;
};

type VotingPricingPlan = {
  id: string;
  voteCount: number;
  price: number;
  discount?: number;
};

type OpenMicData = {
  beatWindow: { start: string; end: string };
  submissionWindow: { start: string; end: string };
  votingWindow: { start: string; end: string };
  beats: Beat[];
  submissionGuidelines: string;
  // Voting Configuration
  votingType: 'free' | 'paid';
  costPerVote: number;
  maxVotesPerUser: number;
  voteWeighting: 'equal' | 'tiered' | 'weighted';
  votingRules: string;
  // Voting Pricing Plans
  votingPricingPlans: VotingPricingPlan[];
  freeVotesPerUser: number;
  freeVoteWindow: number; // in hours (24hrs)
  // Reward Configuration
  rewardType: 'cash' | 'hybrid' | 'non-cash';
  rewardDetails: string;
  maxSongsPerArtist: number;
};

export default function CreateCompetitionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const competitionId = searchParams?.get('id') ?? null;
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'open-mic',
    status: 'draft',
    startDate: '',
    endDate: '',
    registrationDeadline: '',
    maxParticipants: '',
    prizePool: '',
    banner: '',
    currency: 'NGN',
    eligibility: '',
    rules: '',
  });
  const [openMicData, setOpenMicData] = useState<OpenMicData>({
    beatWindow: { start: '', end: '' },
    submissionWindow: { start: '', end: '' },
    votingWindow: { start: '', end: '' },
    beats: [],
    submissionGuidelines: '',
    votingType: 'free',
    costPerVote: 0,
    maxVotesPerUser: 10,
    voteWeighting: 'equal',
    votingRules: '',
    votingPricingPlans: [
      { id: '1', voteCount: 1, price: 100 },
      { id: '2', voteCount: 10, price: 1000 },
      { id: '3', voteCount: 20, price: 1900 },
      { id: '4', voteCount: 40, price: 3500 },
      { id: '5', voteCount: 50, price: 4000 },
      { id: '6', voteCount: 100, price: 7500 },
      { id: '7', voteCount: 200, price: 14000 },
    ],
    freeVotesPerUser: 1,
    freeVoteWindow: 24,
    rewardType: 'cash',
    rewardDetails: '',
    maxSongsPerArtist: 1,
  });
  const [newBeat, setNewBeat] = useState<Partial<Beat>>({
    title: '',
    genre: '',
    duration: '',
  });
  const [newPricingPlan, setNewPricingPlan] = useState<Partial<VotingPricingPlan>>({
    voteCount: 1,
    price: 100,
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

  useEffect(() => {
    if (competitionId && typeof window !== 'undefined') {
      const stored = localStorage.getItem('competitions');
      if (stored) {
        try {
          const competitions = JSON.parse(stored);
          const competition = competitions.find((c: any) => c.id === competitionId);
          if (competition) {
            setFormData({
              title: competition.title || '',
              description: competition.description || '',
              type: competition.type || 'open-mic',
              status: competition.status || 'draft',
              startDate: competition.startDate || '',
              endDate: competition.endDate || '',
              registrationDeadline: competition.registrationDeadline || '',
              maxParticipants: competition.maxParticipants || '',
              prizePool: '',
              banner: competition.banner || '',
              currency: competition.currency || 'NGN',
              eligibility: competition.eligibility || '',
              rules: competition.rules || '',
            });
            if (competition.awards && competition.awards.length > 0) {
              const awardList = competition.awards.map((award: any) => ({
                position: award.position,
                title: award.title || '',
                amount: award.amount || 0,
                benefits: award.benefits || []
              }));
              setAwards(awardList);
              const newBenefitMap: Record<number, Benefit> = {};
              awardList.forEach((award: Award) => {
                newBenefitMap[award.position] = { id: '', name: '', type: 'non-cash', description: '' };
              });
              setNewBenefitByPosition(newBenefitMap);
            }
            if (competition.type === 'open-mic' && competition.openMicData) {
              setOpenMicData(competition.openMicData);
            }
          }
        } catch (err) {
          console.error('Failed to load competition:', err);
        }
      }
    }
  }, [competitionId]);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleOpenMicChange = (field: string, value: string | number) => {
    setOpenMicData(prev => ({ ...prev, [field]: value }));
  };

  const handleOpenMicWindowChange = (window: 'beatWindow' | 'submissionWindow' | 'votingWindow', type: 'start' | 'end', value: string) => {
    setOpenMicData(prev => ({
      ...prev,
      [window]: { ...prev[window], [type]: value }
    }));
  };

  const addBeat = () => {
    if (!newBeat.title?.trim() || !newBeat.genre?.trim() || !newBeat.duration?.trim()) {
      setError('Beat title, genre, and duration are required');
      return;
    }
    const beat: Beat = {
      id: `beat-${Date.now()}`,
      title: newBeat.title.trim(),
      genre: newBeat.genre.trim(),
      duration: newBeat.duration.trim(),
      fileUrl: newBeat.fileUrl || '',
      uploadDate: new Date().toISOString().split('T')[0],
    };
    setOpenMicData(prev => ({
      ...prev,
      beats: [...prev.beats, beat]
    }));
    setNewBeat({ title: '', genre: '', duration: '' });
    setError('');
  };

  const removeBeat = (beatId: string) => {
    setOpenMicData(prev => ({
      ...prev,
      beats: prev.beats.filter(b => b.id !== beatId)
    }));
  };

  const addPricingPlan = () => {
    if (!newPricingPlan.voteCount || !newPricingPlan.price) {
      setError('Vote count and price are required');
      return;
    }
    const plan: VotingPricingPlan = {
      id: `plan-${Date.now()}`,
      voteCount: newPricingPlan.voteCount,
      price: newPricingPlan.price,
      discount: newPricingPlan.discount || 0,
    };
    setOpenMicData(prev => ({
      ...prev,
      votingPricingPlans: [...prev.votingPricingPlans, plan]
    }));
    setNewPricingPlan({ voteCount: 1, price: 100 });
    setError('');
  };

  const removePricingPlan = (planId: string) => {
    setOpenMicData(prev => ({
      ...prev,
      votingPricingPlans: prev.votingPricingPlans.filter(p => p.id !== planId)
    }));
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

      const newCompetition: any = {
        id: `comp-${Date.now()}`,
        title: formData.title.trim(),
        description: formData.description.trim(),
        type: formData.type as 'open-mic' | 'reality-tv' | 'multi-skill' | 'other',
        status: formData.status as 'draft' | 'upcoming' | 'active' | 'ended',
        startDate: formData.startDate,
        endDate: formData.endDate,
        registrationDeadline: formData.registrationDeadline,
        maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants) : null,
        participantCount: 0,
        totalPrizePool: calculateTotalPrizePool(),
        banner: formData.banner,
        currency: formData.currency,
        eligibility: formData.eligibility.trim(),
        rules: formData.rules.trim(),
        awards,
      };

      if (formData.type === 'open-mic') {
        newCompetition.openMicData = openMicData;
      }

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

      if (competitionId) {
        const index = competitions.findIndex((c: any) => c.id === competitionId);
        if (index !== -1) {
          competitions[index] = { ...competitions[index], ...newCompetition, id: competitionId };
        } else {
          competitions.push(newCompetition);
        }
      } else {
        competitions.push(newCompetition);
      }

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

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                Description
              </label>
              <textarea
                placeholder="Brief description of the competition"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.55rem',
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.85rem',
                  background: colors.card,
                  color: colors.text,
                  fontFamily: 'inherit',
                  minHeight: '80px',
                  resize: 'vertical'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                Eligibility Requirements
              </label>
              <textarea
                placeholder="Who can participate (age, location, skills, etc.)"
                value={formData.eligibility}
                onChange={(e) => handleChange('eligibility', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.55rem',
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.85rem',
                  background: colors.card,
                  color: colors.text,
                  fontFamily: 'inherit',
                  minHeight: '80px',
                  resize: 'vertical'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                Rules & Terms
              </label>
              <textarea
                placeholder="Competition rules and terms"
                value={formData.rules}
                onChange={(e) => handleChange('rules', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.55rem',
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.85rem',
                  background: colors.card,
                  color: colors.text,
                  fontFamily: 'inherit',
                  minHeight: '80px',
                  resize: 'vertical'
                }}
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
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                  Registration Deadline
                </label>
                <Input
                  type="date"
                  value={formData.registrationDeadline}
                  onChange={(e) => handleChange('registrationDeadline', e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                  Max Participants
                </label>
                <Input
                  type="number"
                  placeholder="e.g., 500"
                  value={formData.maxParticipants}
                  onChange={(e) => handleChange('maxParticipants', e.target.value)}
                  min="1"
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

        {formData.type === 'open-mic' && (
          <Card title="Open Mic Configuration">
            <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  🎵 Beat Download Window
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Beat Available From
                    </label>
                    <Input
                      type="date"
                      value={openMicData.beatWindow.start}
                      onChange={(e) => handleOpenMicWindowChange('beatWindow', 'start', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Beat Download Until
                    </label>
                    <Input
                      type="date"
                      value={openMicData.beatWindow.end}
                      onChange={(e) => handleOpenMicWindowChange('beatWindow', 'end', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  📤 Song Submission Window
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Submissions Open
                    </label>
                    <Input
                      type="date"
                      value={openMicData.submissionWindow.start}
                      onChange={(e) => handleOpenMicWindowChange('submissionWindow', 'start', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Submissions Close
                    </label>
                    <Input
                      type="date"
                      value={openMicData.submissionWindow.end}
                      onChange={(e) => handleOpenMicWindowChange('submissionWindow', 'end', e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                    Max Songs per Artist
                  </label>
                  <Input
                    type="number"
                    placeholder="e.g., 1"
                    value={openMicData.maxSongsPerArtist}
                    onChange={(e) => handleOpenMicChange('maxSongsPerArtist', parseInt(e.target.value) || 1)}
                    min="1"
                  />
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                    Submission Guidelines
                  </label>
                  <textarea
                    placeholder="E.g., Song must be original creation using provided beat, 3-5 minutes duration, MP3 or WAV format"
                    value={openMicData.submissionGuidelines}
                    onChange={(e) => handleOpenMicChange('submissionGuidelines', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.55rem',
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: '0.375rem',
                      fontSize: '0.85rem',
                      background: colors.card,
                      color: colors.text,
                      fontFamily: 'inherit',
                      minHeight: '80px',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  🗳️ Voting Window
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Voting Opens
                    </label>
                    <Input
                      type="date"
                      value={openMicData.votingWindow.start}
                      onChange={(e) => handleOpenMicWindowChange('votingWindow', 'start', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Voting Closes
                    </label>
                    <Input
                      type="date"
                      value={openMicData.votingWindow.end}
                      onChange={(e) => handleOpenMicWindowChange('votingWindow', 'end', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  🎯 Voting Configuration
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Voting Type
                    </label>
                    <select
                      value={openMicData.votingType}
                      onChange={(e) => handleOpenMicChange('votingType', e.target.value)}
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
                      <option value="free">Free Voting</option>
                      <option value="paid">Paid Voting</option>
                    </select>
                  </div>
                  {openMicData.votingType === 'paid' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                        Cost per Vote (₦)
                      </label>
                      <Input
                        type="number"
                        placeholder="e.g., 50"
                        value={openMicData.costPerVote}
                        onChange={(e) => handleOpenMicChange('costPerVote', parseInt(e.target.value) || 0)}
                        min="0"
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Max Votes per User
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 10"
                      value={openMicData.maxVotesPerUser}
                      onChange={(e) => handleOpenMicChange('maxVotesPerUser', parseInt(e.target.value) || 1)}
                      min="1"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Vote Weighting
                    </label>
                    <select
                      value={openMicData.voteWeighting}
                      onChange={(e) => handleOpenMicChange('voteWeighting', e.target.value)}
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
                      <option value="equal">Equal (1 vote = 1 point)</option>
                      <option value="tiered">Tiered (VIP votes weighted higher)</option>
                      <option value="weighted">Weighted Custom</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                    Voting Rules & Guidelines
                  </label>
                  <textarea
                    placeholder="E.g., Bots and fake accounts will be disqualified. Each user can vote max 10 times. Voting is open to all. Winners determined by total votes received during voting window."
                    value={openMicData.votingRules}
                    onChange={(e) => handleOpenMicChange('votingRules', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.55rem',
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: '0.375rem',
                      fontSize: '0.85rem',
                      background: colors.card,
                      color: colors.text,
                      fontFamily: 'inherit',
                      minHeight: '80px',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  💰 Voting Pricing Plans
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 0.8fr', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Vote Count
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 10"
                      value={newPricingPlan.voteCount || ''}
                      onChange={(e) => setNewPricingPlan({ ...newPricingPlan, voteCount: parseInt(e.target.value) || 0 })}
                      min="1"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Price (₦)
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 1000"
                      value={newPricingPlan.price || ''}
                      onChange={(e) => setNewPricingPlan({ ...newPricingPlan, price: parseInt(e.target.value) || 0 })}
                      min="0"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Discount (%)
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 5"
                      value={newPricingPlan.discount || ''}
                      onChange={(e) => setNewPricingPlan({ ...newPricingPlan, discount: parseInt(e.target.value) || 0 })}
                      min="0"
                      max="100"
                    />
                  </div>
                  <Button onClick={addPricingPlan} style={{ marginTop: '1.5rem' }}>
                    Add
                  </Button>
                </div>

                {openMicData.votingPricingPlans.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.inputBorder}` }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: colors.text }}>Votes</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: colors.text }}>Price (₦)</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: colors.text }}>Price per Vote</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: colors.text }}>Discount</th>
                          <th style={{ textAlign: 'center', padding: '0.5rem', fontWeight: 600, color: colors.text }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openMicData.votingPricingPlans.map((plan) => (
                          <tr key={plan.id} style={{ borderBottom: `1px solid ${colors.inputBorder}` }}>
                            <td style={{ padding: '0.5rem', color: colors.text }}>{plan.voteCount} votes</td>
                            <td style={{ padding: '0.5rem', color: colors.text }}>₦{plan.price.toLocaleString()}</td>
                            <td style={{ padding: '0.5rem', color: colors.muted }}>₦{(plan.price / plan.voteCount).toFixed(2)}</td>
                            <td style={{ padding: '0.5rem', color: colors.text }}>{plan.discount}%</td>
                            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                              <Button
                                onClick={() => removePricingPlan(plan.id)}
                                style={{
                                  padding: '0.3rem 0.6rem',
                                  fontSize: '0.75rem',
                                  background: '#ff4444',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '0.25rem',
                                  cursor: 'pointer'
                                }}
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${colors.inputBorder}` }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Free Votes per User
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 1"
                      value={openMicData.freeVotesPerUser}
                      onChange={(e) => handleOpenMicChange('freeVotesPerUser', parseInt(e.target.value) || 1)}
                      min="0"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                      Free Vote Window (hours)
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g., 24"
                      value={openMicData.freeVoteWindow}
                      onChange={(e) => handleOpenMicChange('freeVoteWindow', parseInt(e.target.value) || 24)}
                      min="1"
                    />
                  </div>
                </div>
              </div>

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  🎼 Available Beats
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1.2fr 0.8fr', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Beat Title
                    </label>
                    <Input
                      placeholder="e.g., Afrobeats Groove"
                      value={newBeat.title || ''}
                      onChange={(e) => setNewBeat({ ...newBeat, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Genre
                    </label>
                    <Input
                      placeholder="e.g., Afrobeats"
                      value={newBeat.genre || ''}
                      onChange={(e) => setNewBeat({ ...newBeat, genre: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      Duration
                    </label>
                    <Input
                      placeholder="e.g., 3:45"
                      value={newBeat.duration || ''}
                      onChange={(e) => setNewBeat({ ...newBeat, duration: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: colors.muted, display: 'block', marginBottom: '0.3rem' }}>
                      File URL
                    </label>
                    <Input
                      type="url"
                      placeholder="https://..."
                      value={newBeat.fileUrl || ''}
                      onChange={(e) => setNewBeat({ ...newBeat, fileUrl: e.target.value })}
                    />
                  </div>
                  <Button variant="primary" onClick={addBeat} style={{ marginBottom: 0, padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}>
                    Add
                  </Button>
                </div>

                {openMicData.beats.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    {openMicData.beats.map((beat) => (
                      <div key={beat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: colors.card, borderRadius: '0.25rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                        <div>
                          <strong>🎵 {beat.title}</strong> • {beat.genre} • {beat.duration}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBeat(beat.id)}
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

              <div style={{ padding: '1rem', background: colors.inputBorder + '15', borderRadius: '0.375rem', borderLeft: `4px solid ${colors.primary}` }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: colors.text, margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
                  🏆 Reward Configuration
                </h4>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                    Reward Type
                  </label>
                  <select
                    value={openMicData.rewardType}
                    onChange={(e) => handleOpenMicChange('rewardType', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.55rem',
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: '0.375rem',
                      fontSize: '0.85rem',
                      background: colors.card,
                      cursor: 'pointer',
                      color: colors.text,
                      marginBottom: '1rem'
                    }}
                  >
                    <option value="cash">Cash Prize</option>
                    <option value="hybrid">Hybrid (Cash + Perks)</option>
                    <option value="non-cash">Non-Cash (Perks Only)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem', color: colors.text }}>
                    Reward Details
                  </label>
                  <textarea
                    placeholder="E.g., 1st Place: ₦100,000 + 3-month promotion, 2nd Place: ₦50,000 + 1-month promotion, 3rd Place: Certificate + featured on homepage"
                    value={openMicData.rewardDetails}
                    onChange={(e) => handleOpenMicChange('rewardDetails', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.55rem',
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: '0.375rem',
                      fontSize: '0.85rem',
                      background: colors.card,
                      color: colors.text,
                      fontFamily: 'inherit',
                      minHeight: '100px',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

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
