'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listApplications,
  decideApplication,
  getRestaurantCuisines,
  setRestaurantCuisines,
} from '@/services/restaurantAdminService';
import type { RestaurantApplication, OnboardingStatus, RestaurantCuisineAssignment } from '@/types/restaurantAdmin';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import {
  FilterChips,
  Pagination,
  applySort,
  nextSort,
  usePagination,
  SortHeaderButton,
  type FilterChip,
  type SortState,
} from '@/components/rbac';
import { Page, PageHeader, Card, Button, Badge, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: (OnboardingStatus | '')[] = ['', 'pending', 'in_review', 'approved', 'rejected', 'suspended'];
const PAGE_SIZE = 20;

type SortKey = 'restaurant_name' | 'owner_name' | 'status' | 'submitted_at';

/** Panel state. `status` is the one field the server understands
 *  (GET /api/restaurant/admin/onboarding?status=), so applying the panel always
 *  re-fetches; the rest narrow the rows already loaded, which is what every
 *  other admin queue page does. */
type Filters = {
  status: OnboardingStatus | '';
  search: string;
  businessType: string;
  bankVerify: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = { status: '', search: '', businessType: '', bankVerify: '', from: '', to: '' };

const BANK_VERIFY_OPTIONS: { value: string; label: string }[] = [
  { value: 'verified', label: 'Bank name verified' },
  { value: 'mismatch', label: 'Name mismatch' },
  { value: 'none', label: 'No bank check on file' },
];

const FILTER_LABELS: Record<keyof Filters, string> = {
  status: 'Status',
  search: 'Search',
  businessType: 'Business type',
  bankVerify: 'Bank verification',
  from: 'Submitted from',
  to: 'Submitted to',
};

/** The day the Submitted column shows, as YYYY-MM-DD in the reviewer's own
 *  timezone, so the range filter and the cell can never disagree. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function selectStyle() {
  return {
    padding: '0.45rem 0.6rem',
    fontSize: '0.8rem',
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    background: 'transparent',
    color: colors.text,
  } as const;
}

const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning,
  in_review: colors.warning,
  approved: colors.success,
  rejected: colors.danger,
  suspended: colors.secondary,
  verified: colors.success,
  unverified: colors.warning,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

/** E2E-PROV-020: status 'pending' covers both "never submitted" and "submitted,
 *  awaiting review" — the raw kyb_status distinguishes them on the badge. */
function onboardingLabel(a: RestaurantApplication): string {
  if (a.status !== 'pending') return a.status;
  if (a.kyb_status == null) return 'not submitted';
  if (a.kyb_status === 'draft') return 'draft — not submitted';
  return 'pending review';
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
    </Card>
  );
}

/** The merchant never got to this KYB step, which is not the same as a check that
 *  failed — a red dash on a never-required field reads as grounds to reject. */
function NotFiled() {
  return <span style={{ color: colors.muted }}>not filed</span>;
}

const businessTypeLabel = (t: string) =>
  t.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export default function OnboardingReviewPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.onboarding);
  const canReview = can(RESTAURANT_PERMS.onboarding);

  const [apps, setApps] = useState<RestaurantApplication[]>([]);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  // Newest submission first: the endpoint already sorts by restaurant created_at
  // DESC, but `submitted_at` is COALESCE(kyb.submitted_at, restaurant.created_at)
  // and is the column the reviewer reads, so the queue opens on it.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'submitted_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<RestaurantApplication | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cuisines, setCuisines] = useState<RestaurantCuisineAssignment | null>(null);
  const [cuisinePick, setCuisinePick] = useState<string[]>([]);
  const [cuisineLoading, setCuisineLoading] = useState(false);
  const [cuisineSaving, setCuisineSaving] = useState(false);
  const [cuisineError, setCuisineError] = useState<string | null>(null);
  const [cuisineNotice, setCuisineNotice] = useState<string | null>(null);

  // Cuisine tags are restaurant-level (restaurant_cuisines) and drive discovery's
  // cuisine filter. The GET is behind restaurant.admin.onboarding, the same slug
  // the decision buttons use, so only fetch when the reviewer may act.
  useEffect(() => {
    if (!selected || !canReview) return;
    let cancelled = false;
    setCuisineLoading(true);
    setCuisineError(null);
    setCuisineNotice(null);
    setCuisinePick([]);
    getRestaurantCuisines(selected.id)
      .then((v) => {
        if (cancelled) return;
        setCuisines(v);
        setCuisinePick(v.selected);
      })
      .catch((e) => {
        if (!cancelled) setCuisineError(String(e));
      })
      .finally(() => {
        if (!cancelled) setCuisineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, canReview]);

  function openReview(a: RestaurantApplication) {
    setCuisines(null);
    setCuisinePick([]);
    setCuisineError(null);
    setCuisineNotice(null);
    setSelected(a);
    setNote(a.review_note ?? '');
  }

  function closeReview() {
    setSelected(null);
    setNote('');
    setCuisines(null);
    setCuisinePick([]);
  }

  function toggleCuisine(id: string) {
    setCuisineNotice(null);
    setCuisinePick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function saveCuisines() {
    if (!selected) return;
    setCuisineSaving(true);
    setCuisineError(null);
    setCuisineNotice(null);
    try {
      const next = await setRestaurantCuisines(selected.id, cuisinePick);
      setCuisines(next);
      setCuisinePick(next.selected);
      setCuisineNotice(
        next.selected.length === 0
          ? 'Cuisine tags cleared.'
          : `Saved ${next.selected.length} cuisine tag${next.selected.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      setCuisineError(String(e));
    } finally {
      setCuisineSaving(false);
    }
  }

  const load = useCallback(async (s: OnboardingStatus | '') => {
    setLoading(true);
    setError(null);
    try {
      setApps(await listApplications(s));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_FILTERS.status);
  }, [load]);

  const applyFilters = () => {
    setApplied(draft);
    setPage(1);
    void load(draft.status);
  };

  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
    void load(EMPTY_FILTERS.status);
  };

  /** Chips always reflect applied state, so clearing one writes both copies —
   *  and a cleared status has to re-fetch, because that field is the server's. */
  const clearFilter = (key: string) => {
    const next = { ...applied, [key]: '' } as Filters;
    setApplied(next);
    setDraft(next);
    setPage(1);
    if (key === 'status') void load(next.status);
  };

  async function decide(decision: 'approve' | 'reject') {
    if (!selected) return;
    if (decision === 'reject' && !note.trim()) {
      setError('A reviewer note is required to reject an application.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await decideApplication(selected.id, decision, note);
      setMessage(`Application ${selected.restaurant_name} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      closeReview();
      await load(applied.status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // "Awaiting review" = the admin can act now: submitted or under review. A draft
  // is not submitted and needs_more_info waits on the merchant. The dashboard's
  // restaurant-kyb queue counts the same two statuses, so the numbers agree.
  const pending = apps.filter((a) => a.kyb_status === 'submitted' || a.kyb_status === 'under_review').length;
  const approved = apps.filter((a) => a.status === 'approved').length;
  const rejected = apps.filter((a) => a.status === 'rejected').length;
  // The merchant form gates both the CAC number and its certificate on the business
  // type, so a sole proprietor legitimately has none and the row must not appear.
  const requiresRegistration = !!selected?.business_type && selected.business_type !== 'sole_proprietor';
  const savedCuisines = new Set(cuisines?.selected ?? []);
  const cuisinesDirty =
    cuisinePick.length !== savedCuisines.size || cuisinePick.some((id) => !savedCuisines.has(id));

  const filtered = useMemo(() => {
    const q = applied.search.trim().toLowerCase();
    return apps.filter((a) => {
      if (q && !`${a.restaurant_name} ${a.owner_name ?? ''} ${a.email ?? ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (applied.businessType && a.business_type !== applied.businessType) return false;
      // Tri-state on purpose: a merchant whose name did not match is a different
      // review problem from one who never filed a settlement account.
      if (applied.bankVerify === 'verified' && a.bank_account_verified !== true) return false;
      if (applied.bankVerify === 'mismatch' && a.bank_account_verified !== false) return false;
      if (applied.bankVerify === 'none' && a.bank_account_verified != null) return false;
      if (applied.from || applied.to) {
        const day = localDay(a.submitted_at);
        if (applied.from && day < applied.from) return false;
        if (applied.to && day > applied.to) return false;
      }
      return true;
    });
  }, [apps, applied]);

  const sorted = useMemo(
    () => applySort(filtered, sort, (a, key) => (a as unknown as Record<string, unknown>)[key]),
    [filtered, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);

  const businessTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const a of apps) if (a.business_type) seen.add(a.business_type);
    return [...seen].sort((x, y) => businessTypeLabel(x).localeCompare(businessTypeLabel(y)));
  }, [apps]);

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const key of Object.keys(FILTER_LABELS) as (keyof Filters)[]) {
      const raw = applied[key];
      if (!raw) continue;
      const value =
        key === 'businessType'
          ? businessTypeLabel(raw)
          : key === 'bankVerify'
            ? BANK_VERIFY_OPTIONS.find((o) => o.value === raw)?.label ?? raw
            : raw;
      out.push({ key, label: FILTER_LABELS[key], value });
    }
    return out;
  }, [applied]);

  const setField = (key: keyof Filters, value: string) => setDraft((f) => ({ ...f, [key]: value }));

  const newestFirst = sort?.key === 'submitted_at' && sort.dir === 'desc';
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));
  const toggleNewestFirst = () => {
    setSort(newestFirst ? { key: 'submitted_at', dir: 'asc' } : { key: 'submitted_at', dir: 'desc' });
    setPage(1);
  };

  if (!canView) {
    return (
      <Page>
        <PageHeader title="Restaurant Onboarding" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.onboarding" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Restaurant Onboarding / KYC"
        subtitle="Review merchant applications and approve or reject KYC. Reject requires a reviewer note."
        actions={<Button variant="outline" onClick={() => void load(applied.status)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Awaiting review" value={String(pending)} accent={pending ? colors.warning : colors.success} />
        <KpiTile label="Approved" value={String(approved)} accent={colors.success} />
        <KpiTile label="Rejected" value={String(rejected)} accent={colors.muted} />
      </div>

      <Card title="Filters" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 14 }}>
          <Input
            placeholder="Search restaurant, owner or email"
            aria-label="Search restaurant, owner or email"
            value={draft.search}
            onChange={(e) => setField('search', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
          />
          <select aria-label="Status" style={selectStyle()} value={draft.status} onChange={(e) => setField('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.filter((s) => s !== '').map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Business type" style={selectStyle()} value={draft.businessType} onChange={(e) => setField('businessType', e.target.value)}>
            <option value="">Any business type</option>
            {businessTypes.map((t) => (
              <option key={t} value={t}>{businessTypeLabel(t)}</option>
            ))}
          </select>
          <select aria-label="Bank verification" style={selectStyle()} value={draft.bankVerify} onChange={(e) => setField('bankVerify', e.target.value)}>
            <option value="">Any bank verification</option>
            {BANK_VERIFY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Input type="date" aria-label="Submitted from" value={draft.from} onChange={(e) => setField('from', e.target.value)} />
          <Input type="date" aria-label="Submitted to" value={draft.to} onChange={(e) => setField('to', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="primary" onClick={applyFilters}>Apply Filters</Button>
          <Button variant="outline" onClick={resetFilters}>Reset</Button>
          <span style={{ fontSize: '0.78rem', color: colors.muted, alignSelf: 'center' }}>
            {total} of {apps.length} applications shown
          </span>
        </div>
      </Card>

      <FilterChips chips={chips} onClear={clearFilter} onClearAll={resetFilters} />

      <Card
        title="Applications"
        right={
          <Button
            sm
            variant={newestFirst ? 'primary' : 'outline'}
            aria-pressed={newestFirst}
            title="Arrange by newest submission first"
            onClick={toggleNewestFirst}
          >
            Latest first
          </Button>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={thCell}>
                  <SortHeaderButton label="Restaurant" active={sort?.key === 'restaurant_name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('restaurant_name')} />
                </th>
                <th style={thCell}>
                  <SortHeaderButton label="Owner" active={sort?.key === 'owner_name'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('owner_name')} />
                </th>
                <th style={thCell}>
                  <SortHeaderButton label="Status" active={sort?.key === 'status'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('status')} />
                </th>
                <th style={thCell}>
                  <SortHeaderButton label="Submitted" active={sort?.key === 'submitted_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('submitted_at')} />
                </th>
                <th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>Loading…</td></tr>
              ) : slice.length === 0 ? (
                <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>No applications match these filters.</td></tr>
              ) : (
                slice.map((a) => (
                  <tr key={a.id}>
                    <td style={tdCell}><strong>{a.restaurant_name}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{a.address}</div></td>
                    <td style={tdCell}>{a.owner_name ?? a.owner_id}<div style={{ color: colors.muted, fontSize: '0.75rem' }}>{a.email}</div></td>
                    <td style={tdCell}><StatusBadge status={a.status} label={onboardingLabel(a)} /></td>
                    <td style={tdCell}>{new Date(a.submitted_at).toLocaleDateString('en-NG')}</td>
                    <td style={tdCell}>
                      <Button sm variant="outline" onClick={() => openReview(a)}>Review</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>

      {selected && (
        <div style={{ marginTop: '1.25rem' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 16 }}>Review — {selected.restaurant_name}</strong>
              <Button sm variant="outline" onClick={closeReview}>Close</Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div><span style={{ color: colors.muted }}>Owner</span><div>{selected.owner_name ?? selected.owner_id}</div></div>
              <div><span style={{ color: colors.muted }}>Legal name</span><div>{selected.legal_name ?? <NotFiled />}</div></div>
              <div><span style={{ color: colors.muted }}>Business type</span><div>{selected.business_type ? businessTypeLabel(selected.business_type) : <NotFiled />}</div></div>
              {/* A sole proprietor is never asked for a CAC number, so showing the
                  row for one invites a rejection over a check that doesn't apply. */}
              {(selected.cac_number || requiresRegistration) && (
                <div>
                  <span style={{ color: colors.muted }}>CAC / RC number</span>
                  <div>{selected.cac_number ?? <span style={{ color: colors.danger }}>not filed</span>}</div>
                </div>
              )}
              <div><span style={{ color: colors.muted }}>Contact phone</span><div>{selected.phone ?? <NotFiled />}</div></div>
              <div><span style={{ color: colors.muted }}>Contact email</span><div>{selected.email ?? <NotFiled />}</div></div>
              {selected.bank_account_number && (
                <>
                  {/* Payouts now land in the owner's wallet and the destination bank is
                      chosen per withdrawal, so these values only exist on applications
                      filed before that change. Unlabelled, a stale "✗ Mismatch" reads as
                      a reason to reject an outlet whose settlement account is no longer
                      what it gets paid to. */}
                  <div style={{ gridColumn: '1 / -1', color: colors.muted, fontSize: '0.75rem' }}>
                    Settlement account filed with an earlier KYB — for history only. Outlets are
                    paid into the owner&apos;s wallet now, so this is not a review criterion.
                  </div>
                  <div>
                    <span style={{ color: colors.muted }}>Settlement bank</span>
                    <div>{selected.bank_name ?? 'code not recognised'} · {selected.bank_account_number}</div>
                  </div>
                  <div><span style={{ color: colors.muted }}>Account name</span><div>{selected.bank_account_name ?? <NotFiled />}</div></div>
                  <div>
                    <span style={{ color: colors.muted }}>Bank verified</span>
                    <div>
                      {selected.bank_account_verified === true ? (
                        <span style={{ color: colors.success }}>✓ Verified</span>
                      ) : selected.bank_account_verified === false ? (
                        <span style={{ color: colors.danger }}>✗ Mismatch</span>
                      ) : selected.bank_account_verified_at ? (
                        <span style={{ color: colors.warning }}>Pending review</span>
                      ) : (
                        <span style={{ color: colors.muted }}>Not verified</span>
                      )}
                    </div>
                    {selected.bank_account_verification_error && (
                      <div style={{ color: colors.danger, fontSize: '0.75rem', marginTop: 4 }}>
                        {selected.bank_account_verification_error}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {selected.documents.length > 0 && (
              <>
                <strong style={{ fontSize: '0.85rem' }}>Documents</strong>
                <ul style={{ margin: '0.5rem 0 1rem', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                  {selected.documents.map((d, i) => (
                    <li key={i}>
                      <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a>{' '}
                      {d.verified ? <StatusBadge status="verified" label="verified" /> : <StatusBadge status="unverified" label="unverified" />}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <strong style={{ fontSize: '0.85rem' }}>Cuisines</strong>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0.25rem 0 0.75rem' }}>
              Tag what this restaurant serves. These tags are restaurant-level and drive cuisine
              filters in discovery. Menu categories are per dish and are assigned from the
              store&apos;s menu, not here.
            </p>
            {!canReview ? (
              <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>
                Requires <code>restaurant.admin.onboarding</code> — cuisine assignment is disabled.
              </p>
            ) : cuisineLoading ? (
              <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>Loading cuisines…</p>
            ) : (
              <>
                {cuisineError && (
                  <p style={{ fontSize: '0.8rem', color: colors.danger, margin: '0 0 0.5rem' }}>{cuisineError}</p>
                )}
                {cuisines && cuisines.available.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0 0 1rem' }}>
                    No cuisines are configured yet. Add them under Restaurant → Menu Taxonomy, then
                    reopen this application.
                  </p>
                ) : cuisines ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                      gap: '0.5rem',
                      marginBottom: '0.75rem',
                      fontSize: '0.85rem',
                    }}
                  >
                    {cuisines.available.map((c) => {
                      const checked = cuisinePick.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          style={{ opacity: !c.is_active && !checked ? 0.5 : 1 }}
                          title={!c.is_active ? 'Inactive cuisine — still selectable to clear an existing tag' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={cuisineSaving || (!c.is_active && !checked)}
                            onChange={() => toggleCuisine(c.id)}
                          />{' '}
                          {c.name}
                          {!c.is_active ? ' (inactive)' : ''}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                  <Button sm variant="primary" disabled={!cuisinesDirty || cuisineSaving} onClick={() => void saveCuisines()}>
                    {cuisineSaving ? 'Saving…' : 'Save cuisines'}
                  </Button>
                  {cuisinesDirty && !cuisineSaving && (
                    <span style={{ fontSize: '0.78rem', color: colors.warning }}>Unsaved changes</span>
                  )}
                  {cuisineNotice && (
                    <span style={{ fontSize: '0.78rem', color: colors.success }}>{cuisineNotice}</span>
                  )}
                </div>
              </>
            )}

            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Reviewer note (required to reject)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Reason / verification notes…"
              style={{ width: '100%', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
              <Button
                variant="primary"
                disabled={!canReview || busy}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : 'Approve merchant'}
                onClick={() => void decide('approve')}
              >
                {busy ? '…' : 'Approve'}
              </Button>
              <Button
                variant="danger"
                disabled={!canReview || busy || !note.trim()}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : !note.trim() ? 'A note is required to reject' : 'Reject merchant'}
                onClick={() => void decide('reject')}
              >
                {busy ? '…' : 'Reject'}
              </Button>
            </div>
            {!canReview && <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: 6 }}>You lack <code>restaurant.admin.onboarding</code> — decisions are disabled. Server still enforces.</p>}
          </Card>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Live routes: <code>GET /api/restaurant/admin/onboarding</code>,{' '}
        <code>POST /api/restaurant/admin/onboarding/:id/&#123;approve|reject&#125;</code> and{' '}
        <code>GET|PUT /api/restaurant/admin/restaurants/:id/cuisines</code> (RBAC{' '}
        <code>restaurant.admin.onboarding</code>).
      </p>
    </Page>
  );
}
