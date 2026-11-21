'use client';

// Platform announcements — the banner every provider portal shows at the top of
// the doctor dashboard. This is the only place a notice can be authored, so it
// is also the only place a bad one can still be refused: the provider-side read
// rewrites an unrecognised tone to "info" rather than failing, and a CTA with a
// label but no route would render a button that goes nowhere.
import { useCallback, useEffect, useState } from 'react';
import {
  listAnnouncements, publishAnnouncement, ANNOUNCEMENT_TONES,
  type AnnouncementTone, type Campaign,
} from '@/services/telemedAdminAnnouncementsService';
import {
  PageHeader, TelemedTabs, Card, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, input, label, select, fmtDate, timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const PAGE_SIZE = 25;

const TONE_COLORS: Record<AnnouncementTone, { fg: string; bg: string }> = {
  info: { fg: colors.info, bg: '#eef2ff' },
  success: { fg: colors.success, bg: '#ecfdf5' },
  warning: { fg: colors.warning, bg: '#fffbeb' },
};

function ToneBadge({ tone }: { tone: AnnouncementTone }) {
  const c = TONE_COLORS[tone] ?? TONE_COLORS.info;
  return <span style={{ padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg }}>{tone}</span>;
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listAnnouncements({ limit: PAGE_SIZE })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Platform announcements"
        subtitle="The notice banner at the top of every provider portal. Publishing sends it to all clinician accounts at once; nothing here targets a single doctor."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TelemedTabs active="announcements" />

      <DisclosureNote>
        Live data from <code>/api/v1/telemedicine/admin/announcements</code>. Reading the history needs
        <code> telemedicine.admin.view</code>; publishing needs <code>telemedicine.admin.manage</code>.
      </DisclosureNote>

      <Composer onPublished={load} />

      <Card title={`Published (${items?.length ?? 0})`}>
        <StateBlock loading={loading && !items} error={error} empty={!!items && items.length === 0}
          emptyText="No announcement has been published yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', opacity: loading ? 0.6 : 1 }}>
            <thead><tr>
              <th style={th()}>Notice</th><th style={th()}>Tone</th><th style={th()}>Reached</th><th style={th()}>Published</th>
            </tr></thead>
            <tbody>
              {(items ?? []).map((c) => (
                <tr key={c.id}>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>{c.title}</div>
                    <div style={{ color: colors.muted, fontSize: '0.78rem', marginTop: '0.15rem' }}>{c.body}</div>
                  </td>
                  <td style={td()}><ToneBadge tone={c.tone} /></td>
                  <td style={td()}>{c.recipients} provider{c.recipients === 1 ? '' : 's'}</td>
                  <td style={td()} title={fmtDate(c.publishedAt)}>{timeAgo(c.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      <AuditNote>
        Each publication writes one unread notification row per provider account and one
        <code> admin_audit_logs</code> entry, so the history above is built from the same rows the
        banner reads — a notice listed here is a notice a provider actually received.
      </AuditNote>
    </div>
  );
}

function Composer({ onPublished }: { onPublished: () => void | Promise<void> }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState<AnnouncementTone>('info');
  const [dismissible, setDismissible] = useState(true);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaRoute, setCtaRoute] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ctaStarted = ctaLabel.trim() !== '' || ctaRoute.trim() !== '';
  const ctaIncomplete = ctaStarted && (ctaLabel.trim() === '' || ctaRoute.trim() === '');
  const invalid = title.trim() === '' || body.trim() === '' || ctaIncomplete;

  async function publish() {
    setBusy(true); setErr(null);
    try {
      const out = await publishAnnouncement({
        title: title.trim(),
        body: body.trim(),
        tone,
        dismissible,
        ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim(), ctaRoute: ctaRoute.trim() } : {}),
      });
      setDone(`Published to ${out.recipients} provider${out.recipients === 1 ? '' : 's'}.`);
      setTitle(''); setBody(''); setTone('info'); setDismissible(true); setCtaLabel(''); setCtaRoute('');
      setConfirming(false);
      await onPublished();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New announcement">
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        <div>
          <label style={label()}>Title</label>
          <input style={input()} maxLength={200} value={title} placeholder="e.g. Scheduled portal maintenance"
            onChange={(e) => { setTitle(e.target.value); setDone(null); }} />
        </div>
        <div>
          <label style={label()}>Message</label>
          <textarea style={{ ...input(), minHeight: 90 }} maxLength={2000} value={body}
            placeholder="What is changing, when, and what the clinician needs to do."
            onChange={(e) => { setBody(e.target.value); setDone(null); }} />
        </div>
        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <label style={label()}>Tone</label>
            <select style={select()} value={tone} onChange={(e) => setTone(e.target.value as AnnouncementTone)}>
              {ANNOUNCEMENT_TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: colors.text, paddingBottom: '0.45rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
            Clinicians can dismiss it
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={label()}>Button label (optional)</label>
            <input style={input()} maxLength={60} value={ctaLabel} placeholder="e.g. See the status page"
              onChange={(e) => setCtaLabel(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={label()}>Button target (optional)</label>
            <input style={input()} maxLength={200} value={ctaRoute} placeholder="/doctor/appointments"
              onChange={(e) => setCtaRoute(e.target.value)} />
          </div>
        </div>
        {ctaIncomplete && (
          <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: 0 }}>
            A button needs somewhere to go — fill in both the label and the target, or leave both empty.
          </p>
        )}
        {done && <p style={{ color: colors.success, fontSize: '0.8rem', margin: 0 }}>{done}</p>}
        {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: 0 }}>{err}</p>}
        <PreviewBanner title={title} body={body} tone={tone} ctaLabel={ctaLabel} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={btnPrimary()} disabled={busy || invalid} onClick={() => setConfirming(true)}>
            Publish to all providers
          </button>
        </div>
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="Confirm publication" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ width: 'min(460px, 100%)', background: colors.card, borderRadius: '0.5rem', padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.4rem', color: colors.text }}>Publish this notice?</h3>
            <p style={{ margin: '0 0 0.9rem', fontSize: '0.82rem', color: colors.muted }}>
              It goes to every provider portal account as an unread banner, all at once. There is no
              recall — correcting it means publishing a second notice.
            </p>
            <PreviewBanner title={title} body={body} tone={tone} ctaLabel={ctaLabel} bordered={false} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button style={btn()} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              <button style={btnPrimary()} disabled={busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish now'}</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function PreviewBanner({ title, body, tone, ctaLabel, bordered = true }: {
  title: string; body: string; tone: AnnouncementTone; ctaLabel: string; bordered?: boolean;
}) {
  if (!title.trim() && !body.trim()) return null;
  const c = TONE_COLORS[tone] ?? TONE_COLORS.info;
  return (
    <div style={bordered ? { border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem' } : undefined}>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.4rem' }}>
        {bordered ? 'Preview' : 'The provider will see'}
      </div>
      <div style={{ borderLeft: `4px solid ${c.fg}`, background: c.bg, borderRadius: '0.375rem', padding: '0.7rem 0.8rem' }}>
        <div style={{ fontWeight: 700, color: colors.text, fontSize: '0.9rem' }}>{title.trim() || '(no title)'}</div>
        <div style={{ color: colors.text, fontSize: '0.82rem', marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>{body}</div>
        {ctaLabel.trim() && <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', fontWeight: 600, color: c.fg }}>{ctaLabel.trim()} →</div>}
      </div>
    </div>
  );
}
