'use client';

import { useEffect, useMemo, useState } from 'react';

type Contest = { id: string; slug: string; title: string; season: string; status: string; visibility: string };
type School = { id: string; schoolName: string; schoolType: string; state?: string; status: string };
type Application = {
  id: string;
  reference: string;
  contestSlug: string;
  applicantType: string;
  track: string;
  status: string;
  paymentStatus: string;
  applicantName?: string;
};

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-spotlight-role': 'admin',
    'x-actor-id': 'admin-console',
  };
}

export default function StemAdminConsole() {
  const badgeClass = (status: string) => {
    const value = status.toLowerCase();
    if (value.includes('approved') || value.includes('verified') || value.includes('published')) return 'badge-approved';
    if (value.includes('rejected') || value.includes('suspended') || value.includes('disqualified')) return 'badge-rejected';
    if (value.includes('paid')) return 'badge-paid';
    return 'badge-pending';
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [contests, setContests] = useState<Contest[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedContestId, setSelectedContestId] = useState('');

  const [contestForm, setContestForm] = useState({ title: '', slug: '', season: '', description: '', status: 'draft', visibility: 'public' });
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [priceForm, setPriceForm] = useState({ name: '', amount: '0', currency: 'NGN' });
  const [prizeForm, setPrizeForm] = useState({ title: '', prizeType: 'overall_winner', cashPrizeAmount: '0' });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [contestRes, schoolRes, appRes] = await Promise.all([
        fetch('/api/admin/stem/contests', { headers: adminHeaders(), cache: 'no-store' }),
        fetch('/api/stem/schools', { cache: 'no-store' }),
        fetch('/api/admin/stem/applications', { headers: adminHeaders(), cache: 'no-store' }),
      ]);

      const contestPayload = await contestRes.json().catch(() => ({}));
      const schoolPayload = await schoolRes.json().catch(() => ({}));
      const appPayload = await appRes.json().catch(() => ({}));

      if (!contestRes.ok || !contestPayload?.success) throw new Error(contestPayload?.error || 'Failed to load contests');
      if (!appRes.ok || !appPayload?.success) throw new Error(appPayload?.error || 'Failed to load applications');

      setContests((contestPayload.contests || []) as Contest[]);
      setSchools((schoolPayload.schools || []) as School[]);
      setApplications((appPayload.applications || []) as Application[]);

      if (!selectedContestId && contestPayload.contests?.[0]?.id) {
        setSelectedContestId(contestPayload.contests[0].id as string);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load STEM admin data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const selectedContest = useMemo(() => contests.find((contest) => contest.id === selectedContestId) || null, [contests, selectedContestId]);

  async function createContest() {
    setError('');
    setMessage('');
    const payload = {
      title: contestForm.title,
      slug: contestForm.slug,
      season: contestForm.season,
      description: contestForm.description,
      status: contestForm.status,
      visibility: contestForm.visibility,
      tracksAllowed: ['school_student', 'independent_innovator', 'mixed'],
      freeEntryEnabled: true,
      paidEntryEnabled: true,
      schoolBulkRegistrationEnabled: true,
      publicProfileEnabled: true,
      votingEnabled: false,
    };

    const res = await fetch('/api/admin/stem/contests', { method: 'POST', headers: adminHeaders(), body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      const reason = data?.errors ? Object.values(data.errors).join(' ') : data?.error || 'Failed to create contest';
      setError(reason);
      return;
    }

    setMessage('Contest created successfully.');
    setContestForm({ title: '', slug: '', season: '', description: '', status: 'draft', visibility: 'public' });
    await loadAll();
  }

  async function publishContest(contestId: string) {
    const res = await fetch(`/api/admin/stem/contests/${contestId}/publish`, { method: 'POST', headers: adminHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to publish contest');
      return;
    }
    setMessage('Contest published.');
    await loadAll();
  }

  async function addCategory() {
    if (!selectedContestId) return;
    const res = await fetch(`/api/admin/stem/contests/${selectedContestId}/categories`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        name: categoryForm.name,
        description: categoryForm.description,
        eligibleTracks: ['school_student', 'independent_innovator', 'mixed'],
        publicProfileVisible: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to add category');
      return;
    }
    setMessage('Category added.');
    setCategoryForm({ name: '', description: '' });
    await loadAll();
  }

  async function addPrice() {
    if (!selectedContestId) return;
    const res = await fetch(`/api/admin/stem/contests/${selectedContestId}/prices`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        name: priceForm.name,
        amount: Number(priceForm.amount || 0),
        currency: priceForm.currency,
        appliesToTracks: ['school_student', 'independent_innovator', 'mixed'],
        appliesToApplicantTypes: ['student', 'independent_innovator', 'team_lead'],
        paymentRequiredBeforeSubmission: false,
        paymentRequiredAfterShortlisting: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to add price category');
      return;
    }
    setMessage('Price category added.');
    setPriceForm({ name: '', amount: '0', currency: 'NGN' });
    await loadAll();
  }

  async function addPrize() {
    if (!selectedContestId) return;
    const res = await fetch(`/api/admin/stem/contests/${selectedContestId}/prizes`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        title: prizeForm.title,
        prizeType: prizeForm.prizeType,
        cashPrizeAmount: Number(prizeForm.cashPrizeAmount || 0),
        numberOfWinners: 1,
        publiclyVisible: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to add prize category');
      return;
    }
    setMessage('Prize category added.');
    setPrizeForm({ title: '', prizeType: 'overall_winner', cashPrizeAmount: '0' });
    await loadAll();
  }

  async function reviewSchool(schoolId: string, status: 'verified' | 'rejected' | 'suspended') {
    const res = await fetch(`/api/stem/schools/${schoolId}/review`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to review school');
      return;
    }
    setMessage(`School marked as ${status}.`);
    await loadAll();
  }

  async function reviewApplication(applicationId: string, status: string) {
    const res = await fetch(`/api/admin/stem/applications/${applicationId}/review`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Failed to review application');
      return;
    }
    setMessage(`Application moved to ${status.replaceAll('_', ' ')}.`);
    await loadAll();
  }

  if (loading) return <p className="text-foreground-muted">Loading STEM Admin Console...</p>;

  return (
    <div>
      {error ? <p className="text-red-400 font-semibold mb-3">{error}</p> : null}
      {message ? <p className="text-emerald-400 font-semibold mb-3">{message}</p> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="glass-card rounded-md p-4">
          <h4 className="font-display text-foreground mb-3">Create STEM Contest</h4>
          <div className="space-y-2">
            <div><label className="form-label">Title</label><input className="form-input" value={contestForm.title} onChange={(e) => setContestForm((p) => ({ ...p, title: e.target.value }))} /></div>
            <div><label className="form-label">Slug</label><input className="form-input" value={contestForm.slug} onChange={(e) => setContestForm((p) => ({ ...p, slug: e.target.value }))} /></div>
            <div><label className="form-label">Season/Edition</label><input className="form-input" value={contestForm.season} onChange={(e) => setContestForm((p) => ({ ...p, season: e.target.value }))} /></div>
            <div><label className="form-label">Description</label><textarea className="form-input min-h-[90px]" value={contestForm.description} onChange={(e) => setContestForm((p) => ({ ...p, description: e.target.value }))} /></div>
            <div><label className="form-label">Status</label><select className="form-input" value={contestForm.status} onChange={(e) => setContestForm((p) => ({ ...p, status: e.target.value }))}><option value="draft">draft</option><option value="scheduled">scheduled</option><option value="published">published</option><option value="open_for_registration">open_for_registration</option></select></div>
            <div><label className="form-label">Visibility</label><select className="form-input" value={contestForm.visibility} onChange={(e) => setContestForm((p) => ({ ...p, visibility: e.target.value }))}><option value="public">public</option><option value="school_only">school_only</option><option value="state_only">state_only</option><option value="private_invite_only">private_invite_only</option></select></div>
          </div>
          <button type="button" className="btn-primary py-2.5 px-4 text-[11px] mt-3" onClick={() => void createContest()}>Create Contest</button>
        </div>

        <div className="glass-card rounded-md p-4">
          <h4 className="font-display text-foreground mb-3">Existing Contests</h4>
          <div className="mb-3">
            <label className="form-label">Selected Contest</label>
            <select className="form-input" value={selectedContestId} onChange={(e) => setSelectedContestId(e.target.value)}>
              <option value="">Select contest</option>
              {contests.map((contest) => <option value={contest.id} key={contest.id}>{contest.title} ({contest.status})</option>)}
            </select>
          </div>
          <ul className="text-sm text-foreground-muted space-y-3">
            {contests.map((contest) => (
              <li key={contest.id}>
                <strong className="text-foreground">{contest.title}</strong> • {contest.season} •{' '}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(contest.status)}`}>
                  {contest.status}
                </span>
                <div className="mt-1"><button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void publishContest(contest.id)}>Publish</button></div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {selectedContest ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          <div className="glass-card rounded-md p-4">
            <h4 className="font-display text-foreground mb-3">Add Category</h4>
            <div className="space-y-2">
              <div><label className="form-label">Name</label><input className="form-input" value={categoryForm.name} onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="form-label">Description</label><textarea className="form-input min-h-[90px]" value={categoryForm.description} onChange={(e) => setCategoryForm((p) => ({ ...p, description: e.target.value }))} /></div>
            </div>
            <button type="button" className="btn-primary py-2.5 px-4 text-[11px] mt-3" onClick={() => void addCategory()}>Save Category</button>
          </div>

          <div className="glass-card rounded-md p-4">
            <h4 className="font-display text-foreground mb-3">Add Price Category</h4>
            <div className="space-y-2">
              <div><label className="form-label">Name</label><input className="form-input" value={priceForm.name} onChange={(e) => setPriceForm((p) => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="form-label">Amount</label><input className="form-input" type="number" value={priceForm.amount} onChange={(e) => setPriceForm((p) => ({ ...p, amount: e.target.value }))} /></div>
              <div><label className="form-label">Currency</label><input className="form-input" value={priceForm.currency} onChange={(e) => setPriceForm((p) => ({ ...p, currency: e.target.value }))} /></div>
            </div>
            <button type="button" className="btn-primary py-2.5 px-4 text-[11px] mt-3" onClick={() => void addPrice()}>Save Price</button>
          </div>

          <div className="glass-card rounded-md p-4">
            <h4 className="font-display text-foreground mb-3">Add Prize Category</h4>
            <div className="space-y-2">
              <div><label className="form-label">Title</label><input className="form-input" value={prizeForm.title} onChange={(e) => setPrizeForm((p) => ({ ...p, title: e.target.value }))} /></div>
              <div><label className="form-label">Prize Type</label><input className="form-input" value={prizeForm.prizeType} onChange={(e) => setPrizeForm((p) => ({ ...p, prizeType: e.target.value }))} /></div>
              <div><label className="form-label">Cash Amount</label><input className="form-input" type="number" value={prizeForm.cashPrizeAmount} onChange={(e) => setPrizeForm((p) => ({ ...p, cashPrizeAmount: e.target.value }))} /></div>
            </div>
            <button type="button" className="btn-primary py-2.5 px-4 text-[11px] mt-3" onClick={() => void addPrize()}>Save Prize</button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <div className="glass-card rounded-md p-4">
          <h4 className="font-display text-foreground mb-3">School Verification Queue</h4>
          <ul className="text-sm text-foreground-muted space-y-3">
            {schools.map((school) => (
              <li key={school.id}>
                <strong className="text-foreground">{school.schoolName}</strong> • {school.schoolType} •{' '}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(school.status)}`}>
                  {school.status}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewSchool(school.id, 'verified')}>Verify</button>
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewSchool(school.id, 'rejected')}>Reject</button>
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewSchool(school.id, 'suspended')}>Suspend</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass-card rounded-md p-4">
          <h4 className="font-display text-foreground mb-3">Application Review Queue</h4>
          <ul className="text-sm text-foreground-muted space-y-3">
            {applications.map((app) => (
              <li key={app.id}>
                <strong className="text-foreground">{app.reference}</strong> • {app.applicantType} •{' '}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(app.status)}`}>
                  {app.status}
                </span>
                <div className="text-xs mt-0.5">{app.applicantName || 'Unknown'} • {app.contestSlug}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewApplication(app.id, 'under_review')}>Under Review</button>
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewApplication(app.id, 'shortlisted')}>Shortlist</button>
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewApplication(app.id, 'approved')}>Approve</button>
                  <button type="button" className="btn-outline py-1.5 px-3 text-[10px]" onClick={() => void reviewApplication(app.id, 'rejected')}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
