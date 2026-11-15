'use client';

/**
 * Create Monthly Open Mic Contest — ported from frontend-web's
 * app/admin/(dashboard)/open-mic/contests/new (OpenMicAdminContestBuilder),
 * as part of the Open Mic Path A console (see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Same fields, same POST /api/admin/open-mic/contests route, reached through the
 * web proxy. The beat arrives as an mp3 upload through /api/web-proxy — the
 * paste-a-URL-only path was removed because the public beat reader serves only
 * /api/open-mic/beats/… paths, so a pasted third-party URL looked fillable and
 * played for nobody.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { createOpenMicContest, uploadOpenMicBeat, type CreateOpenMicContestInput } from '@/services/openMicAdminService';
import { beatUrlProblem } from '@/features/openmic/beat-url';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
];

function slugify(input: string) {
  return input.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 };
const fieldWrap: CSSProperties = { marginBottom: 14 };
const selectStyle: CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 };

export default function NewOpenMicContestPage() {
  const router = useRouter();
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [beatBusy, setBeatBusy] = useState(false);
  // This one line says both "uploaded" and "refused", so it carries its own tone:
  // `tone` drives colour *and* ARIA role, which keeps the distinction true for a
  // screen reader without putting a hex value in the test.
  const [beatNote, setBeatNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [form, setForm] = useState({
    title: '', slug: '', description: '',
    month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    season: `Season ${new Date().getFullYear()}`, status: 'draft',
    registrationFeeNgn: 0, entryFeeRequired: false,
    repeatMonths: 1, autoCreateNext: false, requireNewBeatEveryMonth: true,
    finalistsTarget: 10, judgeWeight: 30, publicVoteWeight: 70,
    venueName: '', venueType: 'lounge', address: '', city: '', state: '',
    beatTitle: '', beatProducerName: '', beatDownloadUrl: '', beatPreviewUrl: '',
    beatUsageRules: 'Beat is provided for this Spotlight Open Mic contest only.',
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = slugify(String(value || ''));
      return next;
    });
  }

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Contest title is required.';
    if (!form.slug.trim()) e.slug = 'Contest slug is required.';
    if (!form.description.trim()) e.description = 'Contest description is required.';
    if (!form.month || form.month < 1 || form.month > 12) e.month = 'Month must be between 1 and 12.';
    if (!form.year || form.year < 2020) e.year = 'Year must be valid.';
    if (form.judgeWeight + form.publicVoteWeight !== 100) e.weights = 'Judge weight and public vote weight must add up to 100%.';
    if (!form.state.trim()) e.state = 'State is required.';
    if (!form.city.trim()) e.city = 'City is required.';
    if (!form.venueName.trim()) e.venueName = 'Finale venue name is required.';
    if (!form.beatTitle.trim()) e.beatTitle = 'Official beat title is required.';
    if (!form.beatDownloadUrl.trim()) e.beatDownloadUrl = 'Upload the official beat mp3.';
    else if (beatUrlProblem(form.beatDownloadUrl) !== null) {
      e.beatDownloadUrl = 'Upload the beat mp3 — the programme page cannot play that address.';
    }
    return e;
  }, [form]);

  async function uploadBeat(file: File) {
    setBeatBusy(true);
    setBeatNote(null);
    try {
      const beat = await uploadOpenMicBeat(file);
      setField('beatDownloadUrl', beat.downloadUrl);
      setField('beatPreviewUrl', beat.previewUrl);
      setBeatNote({ text: 'Beat uploaded — artists can now play and download it.', tone: 'ok' });
    } catch (e) {
      setBeatNote({ text: e instanceof Error ? e.message : String(e), tone: 'bad' });
    } finally {
      setBeatBusy(false);
    }
  }

  async function submit() {
    setError('');
    setMessage('');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Please fix the highlighted fields.');
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const payload: CreateOpenMicContestInput = {
        title: form.title, slug: form.slug, description: form.description,
        month: form.month, year: form.year, season: form.season, status: form.status,
        registrationFeeNgn: form.registrationFeeNgn, entryFeeRequired: form.entryFeeRequired,
        recurrence: {
          enabled: form.repeatMonths > 1 || form.autoCreateNext,
          repeatMonths: form.repeatMonths, autoCreateNext: form.autoCreateNext,
          autoCopySettings: true, autoPublishFuture: false,
          requireNewBeatEveryMonth: form.requireNewBeatEveryMonth,
        },
        beat: {
          beatTitle: form.beatTitle, producerName: form.beatProducerName || 'Spotlight Producer',
          producerCredit: form.beatProducerName || 'Spotlight Producer',
          downloadUrl: form.beatDownloadUrl, previewUrl: form.beatPreviewUrl || form.beatDownloadUrl,
          usageRules: form.beatUsageRules, allowDownload: true, previewOnly: false,
          requiresPaidEntryForDownload: form.entryFeeRequired, cleanVersionRequired: true,
          explicitLyricsAllowed: false,
        },
        finalistsTarget: form.finalistsTarget, judgeWeight: form.judgeWeight, publicVoteWeight: form.publicVoteWeight,
        finale: { venueName: form.venueName, venueType: form.venueType, address: form.address, city: form.city, state: form.state, playbackMode: 'top_10' },
      };
      const result = await createOpenMicContest(payload);
      if (!result.success) {
        setFieldErrors(result.errors ?? {});
        setError(Object.values(result.errors ?? {}).join(' ') || 'Failed to create contest.');
        return;
      }
      setMessage('Monthly Open Mic contest created successfully.');
      window.setTimeout(() => router.push('/admin/open-mic'), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader title="Create Monthly Open Mic Contest" subtitle="Configure month, recurrence, fees, voting weights, and finale venue for a new Open Mic edition." />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 780 }}>
        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Contest Identity</h3>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-title">Contest Title*</label>
            <Input id="open-mic-title" value={form.title} onChange={(e) => setField('title', e.target.value)} style={{ width: '100%' }} />
            {fieldErrors.title && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.title}</p>}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-slug">Contest Slug*</label>
            <Input id="open-mic-slug" value={form.slug} onChange={(e) => { setSlugTouched(true); setField('slug', slugify(e.target.value)); }} style={{ width: '100%' }} />
            {fieldErrors.slug && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.slug}</p>}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-description">Description*</label>
            <textarea id="open-mic-description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={3}
              style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }} />
            {fieldErrors.description && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.description}</p>}
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Edition and Status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="open-mic-month">Month*</label>
              <Input id="open-mic-month" type="number" value={form.month} onChange={(e) => setField('month', Number(e.target.value))} style={{ width: '100%' }} />
              {fieldErrors.month && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.month}</p>}
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="open-mic-year">Year*</label>
              <Input id="open-mic-year" type="number" value={form.year} onChange={(e) => setField('year', Number(e.target.value))} style={{ width: '100%' }} />
              {fieldErrors.year && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.year}</p>}
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Season</label>
              <Input value={form.season} onChange={(e) => setField('season', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} style={selectStyle}>
                <option value="draft">draft</option>
                <option value="scheduled">scheduled</option>
                <option value="published">published</option>
                <option value="registration_open">registration_open</option>
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Economics and Scoring</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldWrap}>
              <label style={labelStyle}>Registration Fee (NGN)</label>
              <Input type="number" value={form.registrationFeeNgn} onChange={(e) => setField('registrationFeeNgn', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Repeat Months</label>
              <Input type="number" value={form.repeatMonths} onChange={(e) => setField('repeatMonths', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Finalists Target</label>
              <Input type="number" value={form.finalistsTarget} onChange={(e) => setField('finalistsTarget', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Judge Weight (%)</label>
              <Input type="number" value={form.judgeWeight} onChange={(e) => setField('judgeWeight', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Public Vote Weight (%)</label>
              <Input type="number" value={form.publicVoteWeight} onChange={(e) => setField('publicVoteWeight', Number(e.target.value))} style={{ width: '100%' }} />
              {fieldErrors.weights && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.weights}</p>}
            </div>
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Official Beat</h3>
          <p style={{ fontSize: 12, color: colors.muted, marginTop: -6, marginBottom: 10 }}>
            Upload the beat mp3. The programme page can only play and offer a file this site
            stores; a URL from another host will not open for an artist.
          </p>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-title">Official Beat Title*</label>
            <Input id="open-mic-beat-title" value={form.beatTitle} onChange={(e) => setField('beatTitle', e.target.value)} style={{ width: '100%' }} />
            {fieldErrors.beatTitle && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.beatTitle}</p>}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Producer Name</label>
            <Input value={form.beatProducerName} onChange={(e) => setField('beatProducerName', e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-file">Upload Beat File (MP3)*</label>
            <Input
              id="open-mic-beat-file"
              type="file"
              accept=".mp3"
              disabled={beatBusy}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void uploadBeat(selected);
              }}
            />
            {beatBusy ? <p style={{ fontSize: 12, color: colors.muted, margin: '4px 0 0' }}>Uploading…</p> : null}
            {beatNote ? (
              <p
                role={beatNote.tone === 'ok' ? 'status' : 'alert'}
                style={{ fontSize: 12, color: beatNote.tone === 'ok' ? colors.success : colors.danger, margin: '4px 0 0' }}
              >
                {beatNote.text}
              </p>
            ) : null}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-download-url">Beat File URL (Download)*</label>
            <Input id="open-mic-beat-download-url" value={form.beatDownloadUrl} onChange={(e) => { setField('beatDownloadUrl', e.target.value); setBeatNote(null); }} placeholder="/api/open-mic/beats/…" style={{ width: '100%' }} />
            {fieldErrors.beatDownloadUrl && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.beatDownloadUrl}</p>}
            {beatUrlProblem(form.beatDownloadUrl) === 'legacy' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                This beat was uploaded before the public-beat fix, so artists get an access error.
                Upload the mp3 instead of pasting a URL.
              </p>
            ) : beatUrlProblem(form.beatDownloadUrl) === 'unplayable' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                The programme page cannot serve that address, so the beat will not play or download.
                Upload the mp3 instead of pasting a URL.
              </p>
            ) : null}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-preview-url">Beat Preview URL (Optional)</label>
            <Input id="open-mic-beat-preview-url" value={form.beatPreviewUrl} onChange={(e) => { setField('beatPreviewUrl', e.target.value); setBeatNote(null); }} placeholder="/api/open-mic/beats/…" style={{ width: '100%' }} />
            {beatUrlProblem(form.beatPreviewUrl) === 'unplayable' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                The player ignores a preview it cannot serve. Upload the mp3, or leave this empty to
                play the download file.
              </p>
            ) : null}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Beat Usage Rules</label>
            <textarea value={form.beatUsageRules} onChange={(e) => setField('beatUsageRules', e.target.value)} rows={2}
              style={{ width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }} />
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Finale Venue</h3>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-venue-name">Finale Venue Name</label>
            <Input id="open-mic-venue-name" value={form.venueName} onChange={(e) => setField('venueName', e.target.value)} style={{ width: '100%' }} />
            {fieldErrors.venueName && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.venueName}</p>}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Venue Type</label>
            <select value={form.venueType} onChange={(e) => setField('venueType', e.target.value)} style={selectStyle}>
              <option value="lounge">Lounge</option>
              <option value="club">Club</option>
              <option value="event_center">Event Center</option>
              <option value="campus_venue">Campus Venue</option>
              <option value="virtual">Virtual</option>
            </select>
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Address</label>
            <Input value={form.address} onChange={(e) => setField('address', e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="open-mic-state">State</label>
              <select id="open-mic-state" value={form.state} onChange={(e) => setField('state', e.target.value)} style={selectStyle}>
                <option value="">Select state</option>
                {NIGERIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {fieldErrors.state && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.state}</p>}
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle} htmlFor="open-mic-city">City</label>
              <Input id="open-mic-city" value={form.city} onChange={(e) => setField('city', e.target.value)} style={{ width: '100%' }} />
              {fieldErrors.city && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.city}</p>}
            </div>
          </div>
        </section>

        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Automation Settings</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.entryFeeRequired} onChange={(e) => setField('entryFeeRequired', e.target.checked)} /> Paid registration required
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={form.autoCreateNext} onChange={(e) => setField('autoCreateNext', e.target.checked)} /> Auto-create next monthly edition
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.requireNewBeatEveryMonth} onChange={(e) => setField('requireNewBeatEveryMonth', e.target.checked)} /> Require new beat every month
          </label>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create Monthly Contest'}</Button>
          {error && <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p>}
          {message && <p style={{ color: colors.success, margin: 0, fontSize: 13 }}>{message}</p>}
        </div>
      </Card>
    </Page>
  );
}
