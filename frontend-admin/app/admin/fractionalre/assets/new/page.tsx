'use client';

// 9.B.2 — Asset onboarding wizard. Multi-step: basics, financials, media,
// documents, returns model. Saves as Draft.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAsset } from '@/services/fractionalreAdminService';
import type { AssetType, CreateAssetInput } from '@/types/fractionalreAdmin';
import { FractionalReTabs } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, colors, tint } from '@/components/ui/vuexy';

const STEPS = ['Basics', 'Financials', 'Media', 'Documents', 'Returns model'];
const TYPES: AssetType[] = ['residential', 'commercial', 'land', 'mixed_use', 'industrial', 'agricultural'];

type Form = {
  name: string; type: AssetType; location: string;
  totalValueNaira: string; unitPriceNaira: string;
  targetYieldPct: string; tenorMonths: string; sponsorId: string;
  mediaUrls: string; documents: string;
};

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function AssetOnboardingWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({
    name: '', type: 'residential', location: '', totalValueNaira: '', unitPriceNaira: '',
    targetYieldPct: '', tenorMonths: '36', sponsorId: '', mediaUrls: '', documents: '',
  });

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const naira2kobo = (s: string) => Math.round((parseFloat(s) || 0) * 100);

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload: CreateAssetInput = {
        name: form.name, type: form.type, location: form.location,
        totalValueKobo: naira2kobo(form.totalValueNaira), unitPriceKobo: naira2kobo(form.unitPriceNaira),
        targetYieldBps: Math.round((parseFloat(form.targetYieldPct) || 0) * 100),
        tenorMonths: parseInt(form.tenorMonths || '0', 10),
        sponsorId: form.sponsorId || undefined,
        mediaUrls: form.mediaUrls ? form.mediaUrls.split('\n').map((x) => x.trim()).filter(Boolean) : [],
      };
      const created = await createAsset(payload);
      router.push(`/admin/fractionalre/assets/${created.id}`);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Page>
      <PageHeader title="Onboard asset" subtitle="Saves as Draft — advance lifecycle later from the asset record." actions={<Button onClick={() => router.push('/admin/fractionalre/assets')}>Cancel</Button>} />
      <FractionalReTabs active="assets" />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <span key={s} style={{ padding: '0.3rem 0.7rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, color: i === step ? '#fff' : i < step ? colors.success : colors.muted, background: i === step ? colors.primary : i < step ? tint(colors.success, 0.14) : colors.headBg }}>{i + 1}. {s}</span>
        ))}
      </div>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {step === 0 && (
          <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 540 }}>
            <div><label style={labelStyle}>Asset name</label><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Ikoyi Heights Tower B" /></div>
            <div><label style={labelStyle}>Type</label><select className="vx-input" value={form.type} onChange={(e) => set('type', e.target.value as AssetType)}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
            <div><label style={labelStyle}>Location (geo-pin set on map)</label><Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Ikoyi, Lagos" /></div>
          </div>
        )}
        {step === 1 && (
          <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 540 }}>
            <div><label style={labelStyle}>Total asset value (₦)</label><Input value={form.totalValueNaira} onChange={(e) => set('totalValueNaira', e.target.value)} placeholder="1200000000" /></div>
            <div><label style={labelStyle}>Unit price (₦)</label><Input value={form.unitPriceNaira} onChange={(e) => set('unitPriceNaira', e.target.value)} placeholder="500000" /></div>
            <p style={{ fontSize: '0.78rem', color: colors.muted }}>Money is stored as integer kobo. Implied units: {form.totalValueNaira && form.unitPriceNaira ? Math.floor((parseFloat(form.totalValueNaira) || 0) / (parseFloat(form.unitPriceNaira) || 1)).toLocaleString('en-NG') : '—'}</p>
          </div>
        )}
        {step === 2 && (
          <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 540 }}>
            <div><label style={labelStyle}>Media / gallery / virtual tour URLs (one per line)</label><textarea className="vx-input" style={{ minHeight: 120 }} value={form.mediaUrls} onChange={(e) => set('mediaUrls', e.target.value)} placeholder="https://…/photo-1.jpg" /></div>
          </div>
        )}
        {step === 3 && (
          <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 540 }}>
            <div><label style={labelStyle}>Documents to attach (title, valuation, insurance) — names, one per line</label><textarea className="vx-input" style={{ minHeight: 120 }} value={form.documents} onChange={(e) => set('documents', e.target.value)} placeholder="C of O.pdf" /></div>
            <p style={{ fontSize: '0.78rem', color: colors.muted }}>Upload happens after the draft is created, via the Documents tab (presigned URLs).</p>
          </div>
        )}
        {step === 4 && (
          <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 540 }}>
            <div><label style={labelStyle}>Sponsor / developer ID</label><Input value={form.sponsorId} onChange={(e) => set('sponsorId', e.target.value)} placeholder="spn-1" /></div>
            <div><label style={labelStyle}>Target yield (% p.a.)</label><Input value={form.targetYieldPct} onChange={(e) => set('targetYieldPct', e.target.value)} placeholder="12" /></div>
            <div><label style={labelStyle}>Tenor (months)</label><Input value={form.tenorMonths} onChange={(e) => set('tenorMonths', e.target.value)} placeholder="36" /></div>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</Button>
        {step < STEPS.length - 1
          ? <Button variant="primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next →</Button>
          : <Button variant="primary" onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save as Draft'}</Button>}
      </div>
    </Page>
  );
}
