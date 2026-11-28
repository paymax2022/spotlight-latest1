'use client';

// Contest templates — admin UI to configure what the image-compositing
// pipeline actually composites onto.
// WHY THIS EXISTS
// The pipeline (template image + contestant cutout -> final image) exists and
// define where a contestant's photo lands on it. Without this screen the
// pipeline has no template to run against and is unreachable in practice.
// Slot placement here is numeric fields, not a drag-and-drop canvas — a
// static preview of the template image with a proportionally-scaled overlay
// box gives a rough visual sense of placement per slot.

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { listVotingContests } from '@/services/competitionsService';
import {
  listContestTemplates, createContestTemplate, updateContestTemplate, getContestTemplate,
  deleteContestTemplate, replaceTemplateSlots,
  duplicateContestTemplate, publishContestTemplate, archiveContestTemplate,
  listContestTemplateVersions, uploadSlotArt, previewContestTemplate, getStudioConfig,
  checkTemplateImage, TEMPLATE_IMAGE_ACCEPT, TEMPLATE_MAX_MB, TEMPLATE_FORMATS_LABEL,
  type ContestTemplate, type ContestTemplatePatch, type StudioConfig, type TemplateSlot,
  type TemplateSlotInput, type TemplateSlotType, type TemplateCropMode, type TemplateStatus,
  type TemplateSlotAnchor, type TemplateVersion,
} from '@/services/contestTemplatesService';
import TemplateStudio, { type SlotArtPatch, type StudioPatch } from './TemplateStudio';
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
    // The four P2 art columns, stated on a brand-new slot as their stored defaults.
    // A draft that omitted them would be the one payload shape the slot writer
    // refuses: rows are replaced, not merged, so a slot that says nothing about its
    // image loses it — and a new slot has no image to keep, so `null` is the truth.
    imageUrl: null,
    anchor: 'auto' as TemplateSlotAnchor,
    bleed: false,
    faceProtect: true,
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

  /**
   * The studio panel's state, all of it here rather than inside the panel.
   *
   * `studioConfig` is read once for the whole screen — the bound table is a
   * property of the renderer, not of a template, so refetching it per expansion
   * would only add a request that can disagree with the one already in hand.
   * `studioDraft` carries the three template-level fields while editing, because
   * the row in `templates` is the *saved* state and the sliders must move on the
   * unsaved one. Its own error/notice channels are separate from the page's so a
   * studio refusal cannot be mistaken for the upload form's, and the panel renders
   * whichever sentence the API answered with, verbatim.
   */
  const [studioConfig, setStudioConfig] = useState<StudioConfig | null>(null);
  const [studioDraft, setStudioDraft] = useState({
    photoMode: 'auto', blendPreset: 'natural', blendSettings: {} as Record<string, unknown>,
  });
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioNotice, setStudioNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; applied: boolean; decisions?: string[] } | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[] | null>(null);
  const previewRef = useRef<{ url: string } | null>(null);

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

  // One configuration read for the whole screen. The slider bounds, the preset and
  // mode lists and the slot anchors are the renderer's own tables, published by
  // /api/admin/photo-config-status, and this file must not restate any of them:
  // a locally typed range is a ceiling that can drift from the compositor's (D5).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await getStudioConfig();
        if (!cancelled) setStudioConfig(cfg);
      } catch (e) {
        if (!cancelled) {
          setStudioError(e instanceof Error ? e.message : 'Could not read the studio configuration');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function upload() {
    if (!uploadFile) return setError('Choose an image file first');
    if (!uploadName.trim()) return setError('Template name is required');
    if (!contestId) return setError('Select a contest first');
    // Second gate, same sentence as the picker: a file that the API must refuse
    // should never spend the upload's worth of time getting there.
    const fileProblem = checkTemplateImage(uploadFile);
    if (fileProblem) return setError(fileProblem);

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

  /**
   * Swap the preview image, revoking the object URL being replaced.
   *
   * The service hands back a `Blob` precisely because URL lifetime belongs to the
   * component that made it: a preview an admin never asked to keep must not stay
   * pinned to the page's memory while they open nine more templates.
   */
  function replacePreview(next: { url: string; applied: boolean; decisions?: string[] } | null) {
    const previous = previewRef.current;
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
    previewRef.current = next;
    setPreview(next);
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
    // A new expansion is a new set of answers: the draft starts from this row's
    // stored values, and the previous row's error sentence, preview and history
    // are not carried over to describe it.
    setStudioDraft({
      photoMode: t.photoMode,
      blendPreset: t.blendPreset,
      blendSettings: t.blendSettings ?? {},
    });
    setStudioError(null); setStudioNotice(null); setVersions(null);
    replacePreview(null);
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

  /**
   * The studio panel's callbacks. All of them write through the service, so the
   * rules about what a slot payload may omit live in one file (see
   * `toWireSlot`), and the rules about which rows are writable live on the server.
   */
  function applyStudioPatch(patch: StudioPatch) {
    setStudioDraft((prev) => ({
      ...prev,
      ...(patch.photoMode !== undefined ? { photoMode: patch.photoMode } : {}),
      ...(patch.blendPreset !== undefined ? { blendPreset: patch.blendPreset } : {}),
      // Key-wise merge: moving one slider must not erase the other overrides, and a
      // knob nobody touched stays unset instead of being written as a fresh
      // override of the position it happens to be drawn at.
      ...(patch.blendSettings !== undefined ? { blendSettings: { ...prev.blendSettings, ...patch.blendSettings } } : {}),
    }));
  }

  function applySlotArt(key: string | undefined, patch: SlotArtPatch) {
    if (!key) return;
    setSlotDrafts((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }

  function onSlotField(index: number, patch: SlotArtPatch) {
    applySlotArt(slotDrafts[index]?._key, patch);
  }

  /** Re-read the row after any write, so the panel shows stored truth, not intent. */
  async function refreshStudioRow(id: string) {
    const fresh = await getContestTemplate(id);
    setStudioDraft({
      photoMode: fresh.photoMode,
      blendPreset: fresh.blendPreset,
      blendSettings: fresh.blendSettings ?? {},
    });
    setSlotDrafts(fresh.slots.map(toDraft));
    await loadTemplates();
    return fresh;
  }

  async function uploadArt(t: ContestTemplate, index: number, file: File) {
    const key = slotDrafts[index]?._key;
    // Same gate as the frame upload, before the transfer: a `.mov` spends nothing
    // but the click, and the admin learns why from the same sentence either way.
    const problem = checkTemplateImage(file);
    if (problem) return setStudioError(problem);
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      const url = await uploadSlotArt(t.id, file);
      applySlotArt(key, { imageUrl: url });
      setStudioNotice('Art uploaded and placed on that slot. It reaches the template when you save.');
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not upload the slot image');
    } finally {
      setStudioBusy(false);
    }
  }

  async function saveStudio(t: ContestTemplate) {
    if (slotDrafts.some((s) => !s.slotName.trim())) {
      return setStudioError('Every slot needs a name');
    }
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      const patch: ContestTemplatePatch = {};
      if (studioDraft.photoMode !== t.photoMode) patch.photoMode = studioDraft.photoMode;
      if (studioDraft.blendPreset !== t.blendPreset) patch.blendPreset = studioDraft.blendPreset;
      if (JSON.stringify(studioDraft.blendSettings) !== JSON.stringify(t.blendSettings ?? {})) {
        patch.blendSettings = studioDraft.blendSettings;
      }
      // Only the fields that actually moved: the route answers 400 when a PATCH
      // carries nothing updatable, and sending an unchanged preset would still be
      // a write to a row whose rendering parameters are supposed to be stable.
      if (Object.keys(patch).length > 0) await updateContestTemplate(t.id, patch);
      await replaceTemplateSlots(t.id, slotDrafts.map(({ _key, id, ...rest }) => ({
        ...rest,
        slotName: rest.slotName.trim(),
      })));
      await refreshStudioRow(t.id);
      setStudioNotice('Studio changes saved.');
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not save the studio changes');
    } finally {
      setStudioBusy(false);
    }
  }

  async function runPreview(t: ContestTemplate, file: File | null) {
    if (!file) {
      return setStudioError('Choose an image to preview with. The preview composites your own file and stores nothing.');
    }
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      const result = await previewContestTemplate(t.id, {
        sample: file,
        photoMode: studioDraft.photoMode,
        blendPreset: studioDraft.blendPreset,
        blendSettings: studioDraft.blendSettings,
      });
      replacePreview({
        url: URL.createObjectURL(result.blob),
        applied: result.applied,
        decisions: Object.entries(result.decisions).map(([k, v]) => `${k}: ${String(v)}`),
      });
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not render the preview');
    } finally {
      setStudioBusy(false);
    }
  }

  async function runPublish(t: ContestTemplate) {
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      const { template: published, archivedIds } = await publishContestTemplate(t.id);
      setStudioNotice(
        `Published v${published.version}. ` +
        (archivedIds.length === 0
          ? 'No other template was active for this contest.'
          : `${archivedIds.length} previously active template${archivedIds.length === 1 ? ' was' : 's'} archived.`),
      );
      setVersions(null);
      await refreshStudioRow(t.id);
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not publish the template');
    } finally {
      setStudioBusy(false);
    }
  }

  async function runDuplicate(t: ContestTemplate) {
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      // The duplicate answers with the new row *and* the slots it copied, so the
      // studio can start editing the copy without a second round trip.
      const { template: copy, slots } = await duplicateContestTemplate(t.id);
      setStudioNotice(`Duplicated as "${copy.name}" v${copy.version}, a draft with the same ${slots.length} slots. Edit the copy.`);
      setExpandedId(copy.id);
      setEditDraft({
        name: copy.name,
        status: copy.status,
        width: String(copy.width || ''),
        height: String(copy.height || ''),
        aspectRatio: copy.aspectRatio || '',
      });
      setStudioDraft({
        photoMode: copy.photoMode,
        blendPreset: copy.blendPreset,
        blendSettings: copy.blendSettings ?? {},
      });
      setSlotDrafts(slots.map(toDraft));
      setVersions(null);
      replacePreview(null);
      await loadTemplates();
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not duplicate the template');
    } finally {
      setStudioBusy(false);
    }
  }

  async function runArchive(t: ContestTemplate) {
    setStudioBusy(true); setStudioError(null); setStudioNotice(null);
    try {
      const { template: archived, changed } = await archiveContestTemplate(t.id);
      setStudioNotice(changed
        ? `Archived v${archived.version}. This contest now has no active template, so new renders will not pick one up.`
        : `v${archived.version} was already archived.`);
      await refreshStudioRow(t.id);
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not archive the template');
    } finally {
      setStudioBusy(false);
    }
  }

  async function showHistory(t: ContestTemplate) {
    setStudioBusy(true); setStudioError(null);
    try {
      setVersions(await listContestTemplateVersions(t.id));
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : 'Could not read the version history');
    } finally {
      setStudioBusy(false);
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

                        {/*
                          The studio half of the row: the three template-level blend
                          fields, each slot's art, the synchronous preview (D3) and the
                          lifecycle actions. It gets the row with the unsaved draft
                          merged over it, so the sliders move on what the admin is
                          editing rather than on what was last stored.
                        */}
                        <TemplateStudio
                          template={{ ...t, ...studioDraft }}
                          slots={slotDrafts}
                          config={studioConfig}
                          busy={studioBusy}
                          error={studioError}
                          notice={studioNotice}
                          preview={preview}
                          versions={versions}
                          onStudioChange={applyStudioPatch}
                          onSlotField={onSlotField}
                          onUploadArt={(index, file) => void uploadArt(t, index, file)}
                          onSave={() => void saveStudio(t)}
                          onPreview={(file) => void runPreview(t, file)}
                          onPublish={() => void runPublish(t)}
                          onDuplicate={() => void runDuplicate(t)}
                          onArchive={() => void runArchive(t)}
                          onShowHistory={() => void showHistory(t)}
                        />
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
              accept={TEMPLATE_IMAGE_ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setUploadFile(file);
                // Refuse it as the file is picked — before the admin fills the
                // rest of the form and waits for a transfer that cannot succeed.
                const problem = checkTemplateImage(file);
                if (problem) setError(problem);
                else if (file) setError(null);
              }}
              style={{ fontSize: 13 }}
            />
            <span style={{ display: 'block', fontSize: 12, color: colors.muted, marginTop: 4 }}>
              {TEMPLATE_FORMATS_LABEL}, up to {TEMPLATE_MAX_MB}MB.
            </span>
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
