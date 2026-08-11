'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listBanners, createBanner, updateBanner, setBannerStatus,
  listCategories, getCategoryContent, upsertCategoryContent,
} from '@/services/marketplaceAdminService';
import type {
  MktBanner, MktBannerInput, MktBannerSlot, MktBannerCtaType, MktCategory, MktCategoryContent,
} from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, AuditNote, PermissionBanner,
  btn, btnPrimary, btnDanger, btnDisabled, input, textarea, th, td, select, label as lbl, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

const SLOTS: MktBannerSlot[] = ['home_hero', 'home_strip', 'category_top'];
const CTA_TYPES: MktBannerCtaType[] = ['none', 'category', 'search', 'listing', 'external'];
const EMPTY: MktBannerInput = { slot: 'home_hero', title: '', subtitle: '', image_url: '', cta_label: '', cta_type: 'none', cta_value: '', start_at: null, end_at: null, sort_order: 0, reason_code: '' };

const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function CmsPage() {
  const { allowed: canEdit } = useMarketplacePermission(MARKETPLACE_PERMS.cms);
  const [banners, setBanners] = useState<MktBanner[]>([]);
  const [cats, setCats] = useState<MktCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [bs, cs] = await Promise.all([listBanners(), listCategories()]); setBanners(bs); setCats(cs); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setMsg(null); setError(null);
    try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — CMS & Banners"
        subtitle="Home promotional banners (scheduled) and per-category landing/SEO content."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="cms" />
      <DisclosureNote>
        Banners are scheduled by a start/end window and go live/expire automatically (ADM-003). Category landing copy and SEO
        metadata are per-category (ADM-004). Every change requires a reason_code and is audited.
      </DisclosureNote>

      {!canEdit && <PermissionBanner permission={MARKETPLACE_PERMS.cms} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <>
          <BannersSection
            banners={banners} cats={cats} canEdit={canEdit} busy={busy}
            onCreate={(inp) => run('ban:create', async () => { const b = await createBanner(inp); setBanners((bs) => [b, ...bs]); setMsg(`Banner “${b.title}” created. Audit entry recorded.`); })}
            onUpdate={(id, inp) => run(`ban:${id}`, async () => { const b = await updateBanner(id, inp); setBanners((bs) => bs.map((x) => (x.id === b.id ? b : x))); setMsg(`Banner “${b.title}” saved. Audit entry recorded.`); })}
            onStatus={(b, status, reason) => run(`ban:st:${b.id}`, async () => { const u = await setBannerStatus(b.id, status, reason); setBanners((bs) => bs.map((x) => (x.id === u.id ? u : x))); setMsg(`Banner “${u.title}” ${status === 'archived' ? 'archived' : 'restored'}. Audit entry recorded.`); })}
          />
          <CategoryContentSection cats={cats} canEdit={canEdit} busy={busy}
            onSaved={(c) => setMsg(`Category content for “${c.category_name}” saved. Audit entry recorded.`)}
            setBusy={setBusy} setError={setError} setMsg={setMsg}
          />
        </>
      )}
    </div>
  );
}

// ── Banners ──────────────────────────────────────────────────────────────────
function BannersSection({ banners, cats, canEdit, busy, onCreate, onUpdate, onStatus }: {
  banners: MktBanner[]; cats: MktCategory[]; canEdit: boolean; busy: string | null;
  onCreate: (inp: MktBannerInput) => void; onUpdate: (id: string, inp: MktBannerInput) => void;
  onStatus: (b: MktBanner, status: 'archived' | 'draft', reason: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null); // null = new
  const [form, setForm] = useState<MktBannerInput>(EMPTY);
  const [statusReason, setStatusReason] = useState<Record<string, string>>({});

  const set = <K extends keyof MktBannerInput>(k: K, v: MktBannerInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  function editBanner(b: MktBanner) {
    setEditingId(b.id);
    setForm({ slot: b.slot, title: b.title, subtitle: b.subtitle, image_url: b.image_url, cta_label: b.cta_label, cta_type: b.cta_type, cta_value: b.cta_value, start_at: b.start_at, end_at: b.end_at, sort_order: b.sort_order, reason_code: '' });
  }
  function newBanner() { setEditingId(null); setForm(EMPTY); }

  const catOptions = cats.map((c) => ({ id: c.id, name: c.name }));
  const canSave = canEdit && form.title.trim() && form.reason_code.trim();

  return (
    <Card title="Home banners (ADM-003)" right={<button onClick={newBanner} style={btn()}>+ New banner</button>}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.25rem' }}>
        <thead><tr><th style={th()}>Slot</th><th style={th()}>Banner</th><th style={th()}>CTA</th><th style={th()}>Schedule</th><th style={th()}>Status</th><th style={th()}>Actions</th></tr></thead>
        <tbody>
          {banners.map((b) => (
            <tr key={b.id}>
              <td style={td()}>{b.slot.replace(/_/g, ' ')}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>#{b.sort_order}</div></td>
              <td style={td()}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {b.image_url ? <img src={b.image_url} alt="" style={{ width: 56, height: 28, objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e7eb' }} /> : null}
                  <div><strong>{b.title}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af', maxWidth: 220 }}>{b.subtitle}</div></div>
                </div>
              </td>
              <td style={td()}>{b.cta_type === 'none' ? '—' : <>{b.cta_label}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{b.cta_type}:{b.cta_value}</div></>}</td>
              <td style={td()}><span style={{ fontSize: '0.78rem' }}>{b.start_at ? fmtDate(b.start_at) : '—'} → {b.end_at ? fmtDate(b.end_at) : '∞'}</span></td>
              <td style={td()}><StatusBadge status={b.status === 'live' ? 'active' : b.status === 'expired' || b.status === 'archived' ? 'expired' : b.status === 'scheduled' ? 'pending_review' : 'draft'} /><div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{b.status}</div></td>
              <td style={td()}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 180 }}>
                  <button style={{ ...btn(), textAlign: 'center' }} onClick={() => editBanner(b)}>Edit</button>
                  <input style={{ ...input(), fontSize: '0.78rem' }} placeholder="reason" value={statusReason[b.id] ?? ''} onChange={(e) => setStatusReason((s) => ({ ...s, [b.id]: e.target.value }))} />
                  {b.status === 'archived' ? (
                    <button style={canEdit && (statusReason[b.id] ?? '').trim() && busy !== `ban:st:${b.id}` ? btnPrimary('#15803d') : btnDisabled()} disabled={!canEdit || !(statusReason[b.id] ?? '').trim() || busy === `ban:st:${b.id}`} onClick={() => onStatus(b, 'draft', (statusReason[b.id] ?? '').trim())}>Restore</button>
                  ) : (
                    <button style={canEdit && (statusReason[b.id] ?? '').trim() && busy !== `ban:st:${b.id}` ? btnDanger() : btnDisabled()} disabled={!canEdit || !(statusReason[b.id] ?? '').trim() || busy === `ban:st:${b.id}`} onClick={() => onStatus(b, 'archived', (statusReason[b.id] ?? '').trim())}>Archive</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Editor */}
      <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '1rem' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.7rem' }}>{editingId ? 'Edit banner' : 'New banner'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem' }}>
          <div><label style={lbl()}>Slot</label><select style={select()} value={form.slot} onChange={(e) => set('slot', e.target.value as MktBannerSlot)}>{SLOTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
          <div><label style={lbl()}>Sort order</label><input style={input()} type="number" value={form.sort_order ?? 0} onChange={(e) => set('sort_order', Number(e.target.value))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl()}>Title</label><input style={input()} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Detty December Deals" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl()}>Subtitle</label><input style={input()} value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="Up to 40% off…" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl()}>Image URL</label><input style={input()} value={form.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://…" />{form.image_url ? <img src={form.image_url} alt="" style={{ marginTop: 6, maxWidth: '100%', height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }} /> : null}</div>
          <div><label style={lbl()}>CTA label</label><input style={input()} value={form.cta_label} onChange={(e) => set('cta_label', e.target.value)} placeholder="Shop now" /></div>
          <div><label style={lbl()}>CTA type</label><select style={select()} value={form.cta_type} onChange={(e) => set('cta_type', e.target.value as MktBannerCtaType)}>{CTA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div>
            <label style={lbl()}>CTA target</label>
            {form.cta_type === 'category' ? (
              <select style={select()} value={form.cta_value} onChange={(e) => set('cta_value', e.target.value)}><option value="">— pick category —</option>{catOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            ) : form.cta_type === 'none' ? (
              <input style={input()} value="" disabled placeholder="n/a" />
            ) : (
              <input style={input()} value={form.cta_value} onChange={(e) => set('cta_value', e.target.value)} placeholder={form.cta_type === 'external' ? 'https://…' : form.cta_type === 'search' ? 'search query' : 'listing id'} />
            )}
          </div>
          <div><label style={lbl()}>Starts</label><input style={input()} type="datetime-local" value={toLocal(form.start_at ?? null)} onChange={(e) => set('start_at', fromLocal(e.target.value))} /></div>
          <div><label style={lbl()}>Ends</label><input style={input()} type="datetime-local" value={toLocal(form.end_at ?? null)} onChange={(e) => set('end_at', fromLocal(e.target.value))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl()}>reason_code</label><input style={input()} value={form.reason_code} onChange={(e) => set('reason_code', e.target.value)} placeholder="campaign_launch" /></div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem' }}>
          <button style={canSave && busy !== (editingId ? `ban:${editingId}` : 'ban:create') ? btnPrimary() : btnDisabled()} disabled={!canSave} onClick={() => (editingId ? onUpdate(editingId, form) : onCreate(form))}>{editingId ? 'Save banner' : 'Create banner'}</button>
          {editingId ? <button style={btn()} onClick={newBanner}>Cancel edit</button> : null}
        </div>
      </div>
    </Card>
  );
}

// ── Category landing / SEO content ───────────────────────────────────────────
function CategoryContentSection({ cats, canEdit, busy, onSaved, setBusy, setError, setMsg }: {
  cats: MktCategory[]; canEdit: boolean; busy: string | null;
  onSaved: (c: MktCategoryContent) => void;
  setBusy: (v: string | null) => void; setError: (v: string | null) => void; setMsg: (v: string | null) => void;
}) {
  const [catId, setCatId] = useState<string>('');
  const [content, setContent] = useState<MktCategoryContent | null>(null);
  const [hero, setHero] = useState('');
  const [intro, setIntro] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [reason, setReason] = useState('');
  const [loadingC, setLoadingC] = useState(false);

  const roots = useMemo(() => cats.filter((c) => !c.parent_id), [cats]);

  async function pick(id: string) {
    setCatId(id); setContent(null);
    if (!id) return;
    setLoadingC(true); setError(null);
    try {
      const c = await getCategoryContent(id);
      setContent(c); setHero(c.hero_heading); setIntro(c.intro_copy); setSeoTitle(c.seo_title); setSeoDesc(c.seo_description); setReason('');
    } catch (e) { setError(String(e)); } finally { setLoadingC(false); }
  }

  async function save() {
    if (!catId || !reason.trim()) { setError('reason_code is required.'); return; }
    setBusy('cms:content'); setMsg(null); setError(null);
    try {
      const c = await upsertCategoryContent(catId, { hero_heading: hero, intro_copy: intro, seo_title: seoTitle, seo_description: seoDesc, reason_code: reason.trim() });
      setContent(c); setReason(''); onSaved(c);
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  return (
    <Card title="Category landing & SEO (ADM-004)">
      <div style={{ maxWidth: 360, marginBottom: '1rem' }}>
        <label style={lbl()}>Category</label>
        <select style={select()} value={catId} onChange={(e) => void pick(e.target.value)}>
          <option value="">— select a category —</option>
          {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loadingC ? <p style={{ color: '#6b7280' }}>Loading…</p> : content ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.9rem', maxWidth: 720 }}>
            <div><label style={lbl()}>Hero heading</label><input style={input()} value={hero} onChange={(e) => setHero(e.target.value)} placeholder="Find your next ride" /></div>
            <div><label style={lbl()}>Intro copy</label><textarea style={textarea()} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="A short paragraph shown on the category landing page." /></div>
            <div><label style={lbl()}>SEO title</label><input style={input()} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="Buy & Sell … in Nigeria | Paymax" /><div style={{ fontSize: '0.7rem', color: seoTitle.length > 60 ? '#9a3412' : '#9ca3af', marginTop: 2 }}>{seoTitle.length}/60 recommended</div></div>
            <div><label style={lbl()}>SEO meta description</label><textarea style={textarea()} value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} placeholder="≤ 160 chars recommended for search snippets." /><div style={{ fontSize: '0.7rem', color: seoDesc.length > 160 ? '#9a3412' : '#9ca3af', marginTop: 2 }}>{seoDesc.length}/160 recommended</div></div>
            <div><label style={lbl()}>reason_code</label><input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="seo_refresh" /></div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', alignItems: 'center' }}>
            <button style={canEdit && reason.trim() && busy !== 'cms:content' ? btnPrimary() : btnDisabled()} disabled={!canEdit || !reason.trim() || busy === 'cms:content'} onClick={() => void save()}>{busy === 'cms:content' ? 'Saving…' : 'Save content'}</button>
            <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Last updated {content.updated_at ? fmtDate(content.updated_at) : '—'}{content.updated_by ? ` by ${content.updated_by}` : ''}.</span>
          </div>
        </>
      ) : <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>Select a category to edit its landing copy and SEO metadata.</p>}
    </Card>
  );
}
