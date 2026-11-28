'use client';

/**
 * The template studio panel (spec §6, plan Task 13).
 *
 * It is the console half of the blend layer: the row's `photo_mode` /
 * `blend_preset` / `blend_settings` and each slot's art, anchor, bleed and face
 * protect. Everything it draws comes from props — the row, the drafts, and the
 * configuration read from `/api/admin/photo-config-status` — and every change
 * leaves as a callback. That is a deliberate boundary, not a style preference:
 *
 * - **No numbers of its own.** Sliders, option lists and enums are published by
 *   the route, which imports them from `frontend-web`'s renderer table. A slider
 *   range typed in here would be a second copy of the ceilings, and a second copy
 *   is how a form ends up offering a value the compositor clamps away (spec §5 D5).
 * - **No request of its own.** The slot rules — replace-not-merge, the art it must
 *   not drop, which rows are writable — live in the service module. A component
 *   that also built payloads would have two owners of those rules, and only one of
 *   them would be tested against the route.
 * - **No state of its own.** The draft lives in the page, so what an admin sees
 *   after a change is a re-render from that draft rather than a local copy that can
 *   drift from what gets saved.
 *
 * Three refusals are drawn here as well as enforced upstream, because each one
 * costs an admin more to discover from a response code than from a greyed button:
 *
 * - **A published row is read-only (D6).** `active` and `archived` are the rows
 *   past renders were produced from, so their art and blend numbers are locked in
 *   the UI exactly as `PATCH …/[templateId]` and `PUT …/slots` refuse them, and the
 *   live way out — Duplicate — is the one control that never locks. `status` and
 *   Archive stay usable: lifecycle is not a rendering parameter, and archiving is
 *   how an admin leaves an active state at all.
 * - **Publish needs a contestant slot**, which is the publish RPC's own guard, and
 *   a row that is already active has nothing left to publish.
 * - **A slot that never stated its art has no art controls.** Saving such a draft
 *   would replace the row and lose the stored image; the service raises before the
 *   request goes out, and this panel declines to offer controls for a field it
 *   cannot see the current value of.
 */
import type { CSSProperties } from 'react';
import type {
  ContestTemplate,
  StudioConfig,
  TemplateSlot,
  TemplateSlotAnchor,
  TemplateVersion,
} from '@/services/contestTemplatesService';
import { Button, colors } from '@/components/ui/vuexy';

/**
 * A slot as the page holds it while editing: `TemplateSlot` plus the client-side
 * bookkeeping the list needs, and with `id` optional because a new slot has none.
 */
export type StudioSlot = Omit<TemplateSlot, 'id'> & { id?: string; _key?: string };

/** Template-level changes. `blendSettings` is merged key-wise by the page, so an
 *  unset knob stays unset rather than being written as a fresh override. */
export type StudioPatch = {
  photoMode?: string;
  blendPreset?: string;
  blendSettings?: Record<string, unknown>;
};

/** Slot-level art changes, one slot at a time. */
export type SlotArtPatch = {
  imageUrl?: string | null;
  anchor?: TemplateSlotAnchor;
  bleed?: boolean;
  faceProtect?: boolean;
};

export type StudioPreviewResult = { url: string; applied: boolean; decisions?: string[] };

export type TemplateStudioProps = {
  template: ContestTemplate;
  slots: StudioSlot[];
  /** `null` while the config read is in flight: the panel then draws no knobs at all. */
  config: StudioConfig | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  preview: StudioPreviewResult | null;
  /** `null` = not asked for yet, which is different from an empty chain. */
  versions: TemplateVersion[] | null;
  onStudioChange: (patch: StudioPatch) => void;
  onSlotField: (index: number, patch: SlotArtPatch) => void;
  onUploadArt: (index: number, file: File) => void;
  onSave: () => void;
  onPreview: (file: File | null) => void;
  onPublish: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onShowHistory: () => void;
};

/** One published bound: `[key, [min, max]]`, in the order the panel draws it. */
export type RangeField = [string, [number, number]];

/**
 * The knobs this renderer answers to, sorted so the panel's order is stable across
 * config reads. Empty without a config — inventing a slider list for a table this
 * package has not read is exactly the second-copy problem the route exists to stop.
 */
export function rangeFields(config: StudioConfig | null | undefined): RangeField[] {
  const bounds = config?.blend?.bounds ?? {};
  return Object.keys(bounds)
    .sort()
    .map((key) => [key, bounds[key]] as RangeField);
}

const STATUS_TONE: Record<string, string> = {
  draft: colors.muted,
  active: colors.success,
  archived: colors.warning,
};

const LABEL: CSSProperties = { display: 'block', fontSize: 12, color: colors.muted, marginBottom: 4 };
const FIELD: CSSProperties = {
  padding: '7px 9px', fontSize: 13, borderRadius: 6, border: `1px solid ${colors.border}`, background: '#fff',
};
const HINT: CSSProperties = { fontSize: 12, color: colors.muted, marginTop: 3 };
const SECTION: CSSProperties = { display: 'grid', gap: 10, marginTop: 14 };

/** A stored override, or `null` when this row does not override the knob at all. */
function overrideValue(settings: Record<string, unknown>, key: string): number | null {
  const raw = settings[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Where an unoverridden thumb sits. This is a neutral position, not the number a
 *  render uses — which is why the row is labelled "not overridden" beside it. */
function midpoint([min, max]: [number, number]): number {
  return min + (max - min) / 2;
}

/** Fine enough to reach every bound's useful values, coarse enough to drag. */
function stepFor([min, max]: [number, number]): number {
  if (Number.isInteger(min) && Number.isInteger(max) && max - min >= 10) return 1;
  const raw = (max - min) / 200;
  if (raw >= 0.1) return Number(raw.toFixed(2));
  if (raw >= 0.01) return Number(raw.toFixed(3));
  return Number(raw.toFixed(4));
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export default function TemplateStudio(props: TemplateStudioProps) {
  const {
    template, slots, config, busy, error, notice, preview, versions,
    onStudioChange, onSlotField, onUploadArt, onSave, onPreview, onPublish, onDuplicate, onArchive, onShowHistory,
  } = props;

  const locked = template.status !== 'draft';
  const settings = (template.blendSettings ?? {}) as Record<string, unknown>;
  const fields = rangeFields(config);
  const blend = config?.blend;
  const hasContestant = slots.some((s) => s.slotType === 'contestant');
  const publishBlocked = busy || locked || !hasContestant;
  const anchors = (blend?.anchors ?? []) as TemplateSlotAnchor[];
  const shadow = typeof settings.shadow === 'string' ? settings.shadow : 'auto';

  const census = (config?.templates ?? {}) as Record<string, unknown>;
  const counted = census.counted !== false;
  const activeCount = num(census.activeCount);
  const readableCount = num(census.readableCount);
  const refused = Array.isArray(census.refused) ? (census.refused as Array<Record<string, unknown>>) : [];

  return (
    <div style={{ display: 'grid', gap: 14, marginTop: 14, borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
      {error && (
        <div style={{ padding: 10, borderRadius: 6, fontSize: 13, background: '#fdecea', color: colors.danger }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: 10, borderRadius: 6, fontSize: 13, background: '#eaf7ee', color: colors.success }}>
          {notice}
        </div>
      )}
      {busy && <div style={{ fontSize: 13, color: colors.muted }} data-action="busy">Saving…</div>}

      {locked && (
        <div style={{ padding: 10, borderRadius: 6, fontSize: 13, background: '#fff8e6', color: '#8a6d1b' }}>
          Published rows are read-only. This v{template.version} is the row past renders were produced from, so its
          blend, photo and slot-art values are locked here exactly as the API refuses them. Duplicate it to edit: the
          copy comes back as a new draft with a new version and the same slots.
        </div>
      )}

      {!config && <div style={{ fontSize: 13, color: colors.muted }}>Loading studio configuration…</div>}

      {config && (
        <section style={SECTION}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <label style={LABEL} htmlFor="studio-preset">Blend preset</label>
              <select
                id="studio-preset"
                data-action="blendPreset"
                data-selected={template.blendPreset}
                style={FIELD}
                value={template.blendPreset}
                disabled={locked || busy}
                onChange={(e) => onStudioChange({ blendPreset: e.target.value })}
              >
                {(blend?.presets ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL} htmlFor="studio-mode">Photo placement</label>
              <select
                id="studio-mode"
                data-action="photoMode"
                data-selected={template.photoMode}
                style={FIELD}
                value={template.photoMode}
                disabled={locked || busy}
                onChange={(e) => onStudioChange({ photoMode: e.target.value })}
              >
                {(blend?.modes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL} htmlFor="studio-shadow">Contact shadow</label>
              <select
                id="studio-shadow"
                data-action="shadow"
                data-selected={shadow}
                style={FIELD}
                value={shadow}
                disabled={locked || busy}
                onChange={(e) => onStudioChange({ blendSettings: { shadow: e.target.value } })}
              >
                {(blend?.shadowModes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {fields.map(([key, bound]) => {
              const [min, max] = bound;
              const stored = overrideValue(settings, key);
              const isSet = stored !== null;
              const resolved = isSet ? Math.min(max, Math.max(min, stored as number)) : midpoint(bound);
              const clamped = isSet && resolved !== stored;
              return (
                <div key={key}>
                  <label style={LABEL} htmlFor={`studio-${key}`}>
                    {key} {isSet ? `· override ${stored}` : '· not overridden'}
                  </label>
                  <input
                    id={`studio-${key}`}
                    type="range"
                    data-field={key}
                    data-set={String(isSet)}
                    style={{ width: '100%' }}
                    min={min}
                    max={max}
                    step={stepFor(bound)}
                    value={resolved}
                    disabled={locked || busy}
                    onChange={(e) => onStudioChange({ blendSettings: { [key]: Number(e.target.value) } })}
                  />
                  <div style={HINT}>
                    {clamped
                      ? `${stored} is outside the range the renderer uses; ${resolved} will render.`
                      : `${min} – ${max}`}
                  </div>
                </div>
              );
            })}
          </div>

          {(config.blockers ?? []).length > 0 && (
            <div style={{ padding: 10, borderRadius: 6, fontSize: 13, background: '#fdecea', color: colors.danger }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Production config</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {config.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          <div style={{ fontSize: 12, color: colors.muted }}>
            {!counted && 'The stored template art could not be read, so nothing here claims a count.'}
            {counted && activeCount !== null && readableCount !== null && (
              <span>
                Template art the renderer can read: {readableCount} of {activeCount} active.
                {refused.length > 0 && (
                  <span> Unreadable: {refused.map((r) => `${String(r.name ?? 'a template')} (${String(r.reason ?? 'refused')} at ${String(r.host ?? 'unknown host')})`).join(', ')}.</span>
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {slots.length > 0 && (
        <section style={SECTION}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Slot art</div>
          {slots.map((s, index) => {
            const stated = (s as { imageUrl?: unknown }).imageUrl !== undefined;
            const name = s.slotName || `slot ${index + 1}`;
            if (!stated) {
              return (
                <div key={s._key ?? s.id ?? index} data-art="unknown" style={{ padding: 10, border: `1px dashed ${colors.border}`, borderRadius: 6, fontSize: 13 }}>
                  <strong>{name}</strong> — this slot's art state unknown, so the panel offers no art controls for it.
                  Saving this draft would replace the slot and drop any image it has stored; reopen the template from
                  the list to load its current art, then edit.
                </div>
              );
            }
            return (
              <div key={s._key ?? s.id ?? index} data-art="known" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: 10, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
                {s.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageUrl} alt={name} style={{ width: 64, height: 64, objectFit: 'contain', border: `1px solid ${colors.border}`, borderRadius: 4 }} />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: 4, background: '#f4f4f5', display: 'grid', placeItems: 'center', fontSize: 11, color: colors.muted, textAlign: 'center' }}>
                    No slot art
                  </div>
                )}
                <div style={{ display: 'grid', gap: 8, minWidth: 220 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                  <div>
                    <label style={LABEL} htmlFor={`studio-anchor-${index}`}>Anchor</label>
                    <select
                      id={`studio-anchor-${index}`}
                      data-action="anchor"
                      data-selected={s.anchor ?? 'auto'}
                      style={FIELD}
                      value={s.anchor ?? 'auto'}
                      disabled={locked || busy}
                      onChange={(e) => onSlotField(index, { anchor: e.target.value as TemplateSlotAnchor })}
                    >
                      {anchors.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        data-action="bleed"
                        data-on={String(s.bleed === true)}
                        checked={s.bleed === true}
                        disabled={locked || busy}
                        onChange={(e) => onSlotField(index, { bleed: e.target.checked })}
                      />
                      Bleed
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        data-action="faceProtect"
                        data-on={String(s.faceProtect !== false)}
                        checked={s.faceProtect !== false}
                        disabled={locked || busy}
                        onChange={(e) => onSlotField(index, { faceProtect: e.target.checked })}
                      />
                      Face protect
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      data-action="upload-art"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      style={{ fontSize: 12 }}
                      disabled={locked || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUploadArt(index, file);
                        e.target.value = '';
                      }}
                    />
                    {s.imageUrl && (
                      <Button variant="outline" sm data-action="remove-art" disabled={locked || busy} onClick={() => onSlotField(index, { imageUrl: null })}>
                        Remove art
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={HINT}>
            Slot rows are replaced, not merged, so saving states every slot's art. Upload puts the file in storage and
            fills the slot; the value reaches the database with the slot save.
          </div>
        </section>
      )}

      <section style={SECTION}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Preview</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="file"
            data-action="preview-sample"
            accept="image/png,image/jpeg,image/webp"
            style={{ fontSize: 12 }}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              onPreview(file);
              e.target.value = '';
            }}
          />
          <span style={HINT}>Your own image, composited with this template's settings and written nowhere.</span>
        </div>
        {preview && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt="Preview" style={{ width: 160, borderRadius: 6, border: `1px solid ${colors.border}` }} />
            <div style={{ fontSize: 13 }}>
              {preview.applied ? 'blend applied' : 'blend declined — the compositor answered with the plain paste'}
              {(preview.decisions ?? []).length > 0 && (
                <div style={HINT}>{(preview.decisions ?? []).join(' · ')}</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" data-action="save" disabled={locked || busy} onClick={onSave}>Save studio changes</Button>
        <Button
          variant="outline"
          data-action="publish"
          title={publishBlocked ? '' : 'Publishing archives the contest\'s other active template'}
          disabled={publishBlocked}
          onClick={onPublish}
        >
          Publish
        </Button>
        <Button variant="outline" data-action="duplicate" disabled={busy} onClick={onDuplicate}>Duplicate</Button>
        <Button variant="outline" data-action="archive" disabled={busy || template.status !== 'active'} onClick={onArchive}>Archive</Button>
        <Button variant="outline" data-action="history" disabled={busy} onClick={onShowHistory}>History</Button>
      </section>

      {locked && template.status === 'active' && !busy && (
        <div style={HINT}>This row is already the active version for its contest; publishing it again would only re-stamp it.</div>
      )}
      {!hasContestant && <div style={{ fontSize: 13, color: colors.warning }}>Publishing needs a contestant slot. Add one in the geometry editor above, or duplicate a template that has one.</div>}

      {versions !== null && (
        <section style={SECTION}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Version history</div>
          {versions.length === 0 && <div style={HINT}>No earlier versions — this is the first template for the contest.</div>}
          {versions.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>v{v.version}</strong>
              <span>{v.name}</span>
              <span style={{ color: STATUS_TONE[v.status] ?? colors.muted }}>{v.status}</span>
              <span style={HINT}>{v.publishedAt ? `published ${v.publishedAt}` : 'never published'}</span>
              <span style={HINT}>created {v.createdAt ?? 'unknown'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
