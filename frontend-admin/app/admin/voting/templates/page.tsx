'use client';

// Contest templates — admin UI to configure what the image-compositing
// pipeline actually composites onto.
//
// WHY THIS EXISTS
// The pipeline (template image + contestant cutout -> final image) exists and
// is tested server-side, but nothing let an operator upload a template or
// define where a contestant's photo lands on it. Without this screen the
// pipeline has no template to run against and is unreachable in practice.
//
// Slot placement here is numeric fields, not a drag-and-drop canvas — a
// static preview of the template image with a proportionally-scaled overlay
// box gives a rough visual sense of placement per slot.

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listContestTemplates, createContestTemplate, updateContestTemplate,
  deleteContestTemplate, replaceTemplateSlots,
  type ContestTemplate, type TemplateSlot, type TemplateSlotInput,
  type TemplateSlotType, type TemplateCropMode, type TemplateStatus,
} from '@/services/contestTemplatesService';
import type { VotingContest } from '@/types/competitions';

const STATUS_COLOR: Record<TemplateStatus, string> = {
  draft: colors.muted,
  active: colors.success,
  archived: colors.warning,
};

const SLOT_TYPES: TemplateSlotType[] = ['contestant', 'runner_up', 'badge', 'logo', 'custom'];
const CROP_MODES: TemplateCropMode[] = ['cover', 'contain', 'fill', 'none'];

type SlotDraft = TemplateSlotInput & { id?: string; _key: string };

function toDraft(s: TemplateSlot): SlotDraft {
  return { ...s, _key: s.id };
}

function newDraft(order: number): SlotDraft {
  return {
    _key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    slotName: '',
    slotType: 'contestant',
    slotOrder: order,
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, zIndex: 0, scale: 1,
    cropMode: 'cover', borderRadius: 0, opacity: 1,
  };
}

function ContestTemplatesInner() {
  const params = useSearchParams();
  const initialContestId = params.get('contestId') ?? '';

  const [contests, setContests] = useState<VotingContest[]>([]);
  const [contestId, setContestId] = useState(initialContestId);
  const [templates, setTemplates] = useState<ContestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', status: 'draft' as TemplateStatus, width: '', height: '', aspectRatio: '' });
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([]);

  const contest = useMemo(() => contests.find((c) => c.id === contestId), [contests, contestId]);

  const loadContests = useCallback(async () => {
    try {
      const rows = await listVotingContests();
      setContests(rows);
      setContestId((current) => current || rows[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contests');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!contestId) return;
    setError(null);
    try {
      setTemplates(await listContestTemplates(contestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    }
  }, [contestId]);

  useEffect(() => { void loadContests(); }, [loadContests]);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  async function upload() {
    if (!uploadFile) return setError('Choose an image file first');
    if (!uploadName.trim()) return setError('Template name is required');
    if (!contestId) return setError('Select a contest first');

    setUploading(true); setError(null); setNotice(null);
    try {
      const form = new FormData();
      form.append('name', uploadName.trim());
      form.append('connectContestId', contestId);
      form.append('file', uploadFile);
      await createContestTemplate(form);
      setNotice('Template uploaded as a draft. Add slots before activating it.');
      setUploadName(''); setUploadFile(null);
      const input = document.getElementById('tpl-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function openTemplate(t: ContestTemplate) {
    if (expandedId === t.id) { setExpandedId(null); return; }
    setExpandedId(t.id);
    setEditDraft({
      name: t.name,
      status: t.status,
      width: String(t.width || ''),
      height: String(t.height || ''),
      aspectRatio: t.aspectRatio || '',
    });
    setSlotDrafts(t.slots.map(toDraft));
    setError(null); setNotice(null);
  }

  async function saveDetails(t: ContestTemplate) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const patch: Record<string, unknown> = {};
      if (editDraft.name.trim() && editDraft.name.trim() !== t.name) patch.name = editDraft.name.trim();
      if (editDraft.status !== t.status) patch.status = editDraft.status;
      if (editDraft.width) patch.width = Number(editDraft.width);
      if (editDraft.height) patch.height = Number(editDraft.height);
      if (editDraft.aspectRatio) patch.aspectRatio = editDraft.aspectRatio;
      await updateContestTemplate(t.id, patch);
      setNotice('Template updated.');
      await loadTemplates();
    } catch (e) {
      // The backend rejects status: 'active' when there's no contestant slot yet —
      // surface that message verbatim rather than a generic failure.
      setError(e instanceof Error ? e.message : 'Could not update the template');
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: ContestTemplate) {
    if (!window.confirm(`Delete the "${t.name}" template? This cannot be undone.`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await deleteContestTemplate(t.id);
      setNotice(`Deleted "${t.name}".`);
      if (expandedId === t.id) setExpandedId(null);
      await loadTemplates();
    } catch (e) {
      // 409: must archive an active template before it can be deleted.
      setError(e instanceof Error ? e.message : 'Could not delete the template');
    } finally {
      setBusy(false);
    }
  }

  function updateSlot(key: string, field: keyof SlotDraft, value: string | number) {
    setSlotDrafts((prev) => prev.map((s) => (s._key === key ? { ...s, [field]: value } : s)));
  }

  function addSlot() {
    setSlotDrafts((prev) => [...prev, newDraft(prev.length)]);
  }

  function removeSlot(key: string) {
    setSlotDrafts((prev) => prev.filter((s) => s._key !== key));
  }

  async function saveSlots(t: ContestTemplate) {
    if (slotDrafts.some((s) => !s.slotName.trim())) {
      return setError('Every slot needs a name');
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload: TemplateSlotInput[] = slotDrafts.map(({ _key, id, ...rest }) => ({
        ...rest,
        slotName: rest.slotName.trim(),
      }));
      await replaceTemplateSlots(t.id, payload);
      setNotice('Slots saved.');
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save slots');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Page><PageHeader title="Contest Templates" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>;
  }

  const banner = (text: string, tone: 'danger' | 'success') => (
    <div style={{
      margin: '0 16px 16px', padding: 12, borderRadius: 6, fontSize: 13,
      background: tone === 'danger' ? '#fdecea' : '#eaf7ee',
      color: tone === 'danger' ? colors.danger : colors.success,
    }}>{text}</div>
  );

  return (
    <Page>
      <PageHeader
        title="Contest Templates"
        subtitle="Branded frames a contestant's photo gets composited onto. Configure a template's slots before activating it."
        actions={<Link href="/admin/competitions/list"><Button variant="outline">All contests</Button></Link>}
      />

      <Card>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="contest" style={{ fontSize: 13, color: colors.muted }}>Contest</label>
          <select
            id="contest"
            value={contestId}
            onChange={(e) => { setContestId(e.target.value); setExpandedId(null); }}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, minWidth: 280 }}
          >
            {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>

        {error && banner(error, 'danger')}
        {notice && banner(notice, 'success')}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thCell} />
              <th style={thCell}>Name</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Version</th>
              <th style={thCell}>Slots</th>
              <th style={thCell} />
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr><td style={tdCell} colSpan={6}>No templates yet for this contest.</td></tr>
            )}
            {templates.map((t) => (
              <>
                <tr key={t.id}>
                  <td style={tdCell}>
                    {(t.thumbnailUrl || t.templateUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.thumbnailUrl || t.templateUrl}
                        alt={t.name}
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}` }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 6, background: colors.border }} />
                    )}
                  </td>
                  <td style={tdCell}>{t.name}</td>
                  <td style={tdCell}><Badge text={t.status} color={STATUS_COLOR[t.status]} /></td>
                  <td style={tdCell}>v{t.version}</td>
                  <td style={tdCell}>{t.slots.length}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="outline" sm onClick={() => openTemplate(t)}>
                        {expandedId === t.id ? 'Close' : 'Edit'}
                      </Button>
                      <Button variant="danger" sm disabled={busy} onClick={() => void remove(t)}>Delete</Button>
                    </div>
                  </td>
                </tr>
                {expandedId === t.id && (
                  <tr key={`${t.id}-detail`}>
                    <td style={{ ...tdCell, padding: 0 }} colSpan={6}>
                      <div style={{ padding: 16, background: '#fafafa' }}>
                        {/* Details */}
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Name</label>
                            <Input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Status</label>
                            <select
                              value={editDraft.status}
                              onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as TemplateStatus })}
                              style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}` }}
                            >
                              <option value="draft">draft</option>
                              <option value="active">active</option>
                              <option value="archived">archived</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Width</label>
                            <Input type="number" min={0} value={editDraft.width} onChange={(e) => setEditDraft({ ...editDraft, width: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Height</label>
                            <Input type="number" min={0} value={editDraft.height} onChange={(e) => setEditDraft({ ...editDraft, height: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Aspect ratio</label>
                            <Input value={editDraft.aspectRatio} onChange={(e) => setEditDraft({ ...editDraft, aspectRatio: e.target.value })} placeholder="4:5" />
                          </div>
                        </div>
                        <Button variant="primary" sm disabled={busy} onClick={() => void saveDetails(t)}>
                          {busy ? 'Saving…' : 'Save details'}
                        </Button>

                        {/* Preview + slot editor */}
                        <div style={{ marginTop: 20, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          {t.templateUrl && (
                            <div style={{ position: 'relative', width: 260, flexShrink: 0 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={t.templateUrl} alt={t.name} style={{ width: '100%', display: 'block', borderRadius: 6, border: `1px solid ${colors.border}` }} />
                              {t.width > 0 && t.height > 0 && slotDrafts.map((s) => (
                                <div
                                  key={s._key}
                                  title={s.slotName || s.slotType}
                                  style={{
                                    position: 'absolute',
                                    left: `${(s.x / t.width) * 100}%`,
                                    top: `${(s.y / t.height) * 100}%`,
                                    width: `${(s.width / t.width) * 100}%`,
                                    height: `${(s.height / t.height) * 100}%`,
                                    border: `2px solid ${colors.primary}`,
                                    background: tint(colors.primary, 0.18),
                                    boxSizing: 'border-box',
                                    pointerEvents: 'none',
                                  }}
                                />
                              ))}
                            </div>
                          )}

                          <div style={{ flex: 1, minWidth: 320 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                              <h4 style={{ margin: 0, fontSize: 14 }}>Slots ({slotDrafts.length})</h4>
                              <Button variant="outline" sm onClick={addSlot}>Add slot</Button>
                              <Button variant="primary" sm disabled={busy} style={{ marginLeft: 'auto' }} onClick={() => void saveSlots(t)}>
                                {busy ? 'Saving…' : 'Save slots'}
                              </Button>
                            </div>

                            {slotDrafts.length === 0 && (
                              <p style={{ fontSize: 12, color: colors.muted }}>
                                No slots yet. A template needs at least one <code>contestant</code> slot before it can be activated.
                              </p>
                            )}

                            {slotDrafts.map((s) => (
                              <div key={s._key} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                                  <Input
                                    placeholder="Slot name"
                                    value={s.slotName}
                                    onChange={(e) => updateSlot(s._key, 'slotName', e.target.value)}
                                    style={{ flex: 1 }}
                                  />
                                  <select
                                    value={s.slotType}
                                    onChange={(e) => updateSlot(s._key, 'slotType', e.target.value)}
                                    style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}` }}
                                  >
                                    {SLOT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                  <Button variant="danger" sm onClick={() => removeSlot(s._key)}>Remove</Button>
                                </div>
                                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' }}>
                                  {(['slotOrder', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'scale', 'borderRadius', 'opacity'] as const).map((field) => (
                                    <div key={field}>
                                      <label style={{ display: 'block', fontSize: 11, color: colors.muted, marginBottom: 2 }}>{field}</label>
                                      <Input
                                        type="number"
                                        value={String(s[field])}
                                        onChange={(e) => updateSlot(s._key, field, Number(e.target.value))}
                                      />
                                    </div>
                                  ))}
                                  <div>
                                    <label style={{ display: 'block', fontSize: 11, color: colors.muted, marginBottom: 2 }}>cropMode</label>
                                    <select
                                      value={s.cropMode}
                                      onChange={(e) => updateSlot(s._key, 'cropMode', e.target.value)}
                                      style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}` }}
                                    >
                                      {CROP_MODES.map((v) => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Upload new template" style={{ marginTop: 16 }}>
        <div style={{ padding: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label htmlFor="tpl-name" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Name</label>
            <Input id="tpl-name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="Grand Finale Frame" />
          </div>
          <div>
            <label htmlFor="tpl-file" style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 }}>Image</label>
            <input
              id="tpl-file"
              type="file"
              accept="image/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 13 }}
            />
          </div>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="primary" disabled={uploading || !contestId} onClick={() => void upload()}>
            {uploading ? 'Uploading…' : 'Upload template'}
          </Button>
          {!contestId && <span style={{ fontSize: 12, color: colors.muted }}>Select a contest above first.</span>}
        </div>
      </Card>
    </Page>
  );
}

export default function ContestTemplatesPage() {
  // useSearchParams needs a Suspense boundary under the app router.
  return (
    <Suspense fallback={<Page><PageHeader title="Contest Templates" /><Card><div style={{ padding: 24 }}>Loading…</div></Card></Page>}>
      <ContestTemplatesInner />
    </Suspense>
  );
}
