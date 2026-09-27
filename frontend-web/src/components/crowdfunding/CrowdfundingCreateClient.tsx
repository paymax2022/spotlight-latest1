'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CrowdfundingApiError, listCategories, submitCampaign, uploadCampaignImage } from '@/src/lib/crowdfunding/api';
import { formatNaira } from '@/src/lib/crowdfunding/format';
import type {
  CampaignCategory,
  CampaignType,
  SubmitBudgetItem,
  SubmitMilestone,
  SubmitRewardTier,
} from '@/src/types/crowdfunding-customer';

const TYPES: Array<{ id: CampaignType; label: string }> = [
  { id: 'DONATION', label: 'Donation' },
  { id: 'REWARD', label: 'Reward-Based' },
  { id: 'COMMUNITY', label: 'Community' },
  { id: 'SME', label: 'Small Business' },
];

const DISBURSEMENT_MODELS = [
  { id: 'IMMEDIATE', label: 'Immediate — withdraw as funds arrive' },
  { id: 'ALL_OR_NOTHING', label: 'All or Nothing — refunded if goal is missed' },
  { id: 'FLEXIBLE', label: 'Flexible — keep whatever is raised' },
  { id: 'MILESTONE', label: 'Milestone — released per milestone' },
];

let rowId = 0;
function nextRowId() { rowId += 1; return rowId; }

type BudgetRow = SubmitBudgetItem & { key: number };
type MilestoneRow = SubmitMilestone & { key: number };
type RewardRow = SubmitRewardTier & { key: number };

export default function CrowdfundingCreateClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<CampaignCategory[]>([]);
  const [type, setType] = useState<CampaignType>('DONATION');
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [story, setStory] = useState('');
  const [goalNaira, setGoalNaira] = useState('');
  const [deadline, setDeadline] = useState('');
  const [location, setLocation] = useState('');
  const [refundPolicy, setRefundPolicy] = useState('');
  const [disbursementModel, setDisbursementModel] = useState('IMMEDIATE');
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const [budget, setBudget] = useState<BudgetRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [rewardTiers, setRewardTiers] = useState<RewardRow[]>([]);

  const [beneficiaryEnabled, setBeneficiaryEnabled] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState('');
  const [beneficiaryDescription, setBeneficiaryDescription] = useState('');

  const [busy, setBusy] = useState<'draft' | 'review' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void listCategories().then(setCategories).catch(() => {});
  }, []);

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    setMessage('');
    try {
      const result = await uploadCampaignImage(file);
      if (result) setCoverImageUrl(result.url);
    } catch (err) {
      setMessage(err instanceof CrowdfundingApiError ? err.message : 'Unable to upload cover image.');
    } finally {
      setUploadingCover(false);
    }
  }

  function addBudgetRow() { setBudget((prev) => [...prev, { key: nextRowId(), label: '', amountKobo: 0 }]); }
  function updateBudgetRow(key: number, patch: Partial<BudgetRow>) { setBudget((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r)); }
  function removeBudgetRow(key: number) { setBudget((prev) => prev.filter((r) => r.key !== key)); }

  function addMilestoneRow() { setMilestones((prev) => [...prev, { key: nextRowId(), title: '', targetKobo: 0, status: '' }]); }
  function updateMilestoneRow(key: number, patch: Partial<MilestoneRow>) { setMilestones((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r)); }
  function removeMilestoneRow(key: number) { setMilestones((prev) => prev.filter((r) => r.key !== key)); }

  function addRewardRow() { setRewardTiers((prev) => [...prev, { key: nextRowId(), title: '', amountKobo: 0, description: '' }]); }
  function updateRewardRow(key: number, patch: Partial<RewardRow>) { setRewardTiers((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r)); }
  function removeRewardRow(key: number) { setRewardTiers((prev) => prev.filter((r) => r.key !== key)); }

  async function submit(submitForReview: boolean) {
    if (!title.trim()) { setMessage('Please enter a campaign title.'); return; }
    if (!category) { setMessage('Please choose a category.'); return; }
    const goalKobo = Math.round(Number(goalNaira || 0) * 100);
    if (!Number.isFinite(goalKobo) || goalKobo < 100) { setMessage('Please enter a valid funding goal.'); return; }

    setBusy(submitForReview ? 'review' : 'draft');
    setMessage('');
    try {
      const result = await submitCampaign({
        type,
        category,
        title: title.trim(),
        summary: summary.trim() || undefined,
        story: story.trim() || undefined,
        goalKobo,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        location: location.trim() || undefined,
        refundPolicy: refundPolicy.trim() || undefined,
        disbursementModel,
        coverImageUrl,
        submitForReview,
        milestones: milestones.filter((m) => m.title.trim()).map(({ key: _key, ...m }) => m),
        budget: budget.filter((b) => b.label.trim()).map(({ key: _key, ...b }) => b),
        rewardTiers: rewardTiers.filter((r) => r.title.trim()).map(({ key: _key, ...r }) => r),
        beneficiary: beneficiaryEnabled && beneficiaryName.trim()
          ? { name: beneficiaryName.trim(), relationship: beneficiaryRelationship.trim(), description: beneficiaryDescription.trim() || undefined }
          : null,
      });
      if (!result) return; // redirected to login
      router.push(`/crowdfunding/${result.campaignId}`);
    } catch (e) {
      setMessage(e instanceof CrowdfundingApiError ? e.message : 'Unable to submit your campaign.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5" style={{ maxWidth: 720, margin: '0 auto' }}>
      <p className="section-label mb-2">Start a Campaign</p>
      <h1 className="font-display text-3xl text-foreground" style={{ marginBottom: 20 }}>Tell your story</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Campaign Type</span>
          <select className="form-input mt-1" value={type} onChange={(e) => setType(e.target.value as CampaignType)}>
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Category</span>
          <select className="form-input mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select a category</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <label className="d-block" style={{ marginBottom: 16 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Title</span>
        <input className="form-input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>

      <label className="d-block" style={{ marginBottom: 16 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Short Summary</span>
        <input className="form-input mt-1" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One or two sentences backers see in listings" />
      </label>

      <label className="d-block" style={{ marginBottom: 16 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Full Story</span>
        <textarea className="form-input mt-1" rows={6} value={story} onChange={(e) => setStory(e.target.value)} />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Funding Goal (₦)</span>
          <input type="number" className="form-input mt-1" value={goalNaira} onChange={(e) => setGoalNaira(e.target.value)} min={1} />
        </label>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Deadline (optional — defaults to 60 days)</span>
          <input type="date" className="form-input mt-1" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Location</span>
          <input className="form-input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="d-block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Disbursement Model</span>
          <select className="form-input mt-1" value={disbursementModel} onChange={(e) => setDisbursementModel(e.target.value)}>
            {DISBURSEMENT_MODELS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <label className="d-block" style={{ marginBottom: 20 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Refund Policy</span>
        <textarea className="form-input mt-1" rows={2} value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value)} />
      </label>

      <div style={{ marginBottom: 20 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Cover Image</span>
        <div style={{ marginTop: 6 }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void onCoverChange(e)} disabled={uploadingCover} />
          {uploadingCover && <p style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Uploading…</p>}
          {coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImageUrl} alt="Campaign cover" style={{ marginTop: 8, maxWidth: 240, borderRadius: 8 }} />
          )}
        </div>
      </div>

      {/* Budget */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h5 style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Use of Funds (optional)</h5>
          <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={addBudgetRow}>+ Add Line</button>
        </div>
        {budget.map((row) => (
          <div key={row.key} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input className="form-input" placeholder="Label" value={row.label} onChange={(e) => updateBudgetRow(row.key, { label: e.target.value })} style={{ flex: '1 1 160px' }} />
            <input type="number" className="form-input" placeholder="Amount (₦)" onChange={(e) => updateBudgetRow(row.key, { amountKobo: Math.round(Number(e.target.value || 0) * 100) })} style={{ width: 140 }} />
            <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={() => removeBudgetRow(row.key)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Milestones */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h5 style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Milestones (optional)</h5>
          <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={addMilestoneRow}>+ Add Milestone</button>
        </div>
        {milestones.map((row) => (
          <div key={row.key} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input className="form-input" placeholder="Title" value={row.title} onChange={(e) => updateMilestoneRow(row.key, { title: e.target.value })} style={{ flex: '1 1 160px' }} />
            <input type="number" className="form-input" placeholder="Target (₦)" onChange={(e) => updateMilestoneRow(row.key, { targetKobo: Math.round(Number(e.target.value || 0) * 100) })} style={{ width: 140 }} />
            <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={() => removeMilestoneRow(row.key)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Reward tiers */}
      {type === 'REWARD' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h5 style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Reward Tiers</h5>
            <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={addRewardRow}>+ Add Tier</button>
          </div>
          {rewardTiers.map((row) => (
            <div key={row.key} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input className="form-input" placeholder="Title" value={row.title} onChange={(e) => updateRewardRow(row.key, { title: e.target.value })} style={{ flex: '1 1 140px' }} />
              <input type="number" className="form-input" placeholder="Amount (₦)" onChange={(e) => updateRewardRow(row.key, { amountKobo: Math.round(Number(e.target.value || 0) * 100) })} style={{ width: 120 }} />
              <input className="form-input" placeholder="Description" value={row.description} onChange={(e) => updateRewardRow(row.key, { description: e.target.value })} style={{ flex: '1 1 160px' }} />
              <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={() => removeRewardRow(row.key)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Beneficiary */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          <input type="checkbox" checked={beneficiaryEnabled} onChange={(e) => setBeneficiaryEnabled(e.target.checked)} />
          I&apos;m raising this on behalf of someone else
        </label>
        {beneficiaryEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="form-input" placeholder="Beneficiary name" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />
            <input className="form-input" placeholder="Relationship (e.g. Mother)" value={beneficiaryRelationship} onChange={(e) => setBeneficiaryRelationship(e.target.value)} />
            <textarea className="form-input" placeholder="Description (optional)" value={beneficiaryDescription} onChange={(e) => setBeneficiaryDescription(e.target.value)} style={{ gridColumn: '1 / -1' }} />
          </div>
        )}
      </div>

      {goalNaira && Number(goalNaira) > 0 && (
        <p style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>Goal: {formatNaira(Math.round(Number(goalNaira) * 100))}</p>
      )}

      {message && <p className="form-error" style={{ marginBottom: 12 }}>{message}</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" disabled={busy !== null} onClick={() => void submit(false)}>
          {busy === 'draft' ? 'Saving…' : 'Save as Draft'}
        </button>
        <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy !== null} onClick={() => void submit(true)}>
          {busy === 'review' ? 'Submitting…' : 'Submit for Review'}
        </button>
        <Link href="/crowdfunding" className="btn-outline py-2.5 px-4 text-[11px]">Cancel</Link>
      </div>
    </div>
  );
}
