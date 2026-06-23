// ── Spotlight Realtor — Owner / landlord data layer (V2) ─────────────────────
// Mock by default (REALTOR_USE_MOCK). Real branch hits the property-graph tables
// (20260620000000) + realtor_owner_dashboard RPC (20260620020000).

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import { formatNaira } from '../utils/realtorFormatters';
import type {
  OwnerDashboard,
  CreatePropertyDraft,
  CreateUnitDraft,
  UnitOfferings,
  OfferingModeConfig,
  VoidCandidate,
} from '../types/realtor.owner.types';

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const IMG = (s: string) => `https://picsum.photos/seed/${s}/800/600`;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mock store (default path) ────────────────────────────────────────────────
const properties = [
  { id: 'op_1', name: 'Lekki Phase 1 Apartments', area: 'Lekki Phase 1', city: 'Lagos', coverUrl: IMG('own1'), unitCount: 6, occupiedCount: 5, monthlyRent: 3_250_000_00, arrears: 0 },
  { id: 'op_2', name: 'Yaba Studios', area: 'Yaba', city: 'Lagos', coverUrl: IMG('own2'), unitCount: 4, occupiedCount: 3, monthlyRent: 800_000_00, arrears: 150_000_00 },
];

const unitOfferings: Record<string, UnitOfferings> = {
  ou_1: {
    unitId: 'ou_1', unitLabel: 'Flat 3B', status: 'vacant',
    modes: [
      { mode: 'long_rent', enabled: true, price: 6_500_000_00, rentSchedule: 'annual', cautionDeposit: 650_000_00 },
      { mode: 'short_stay', enabled: false, price: 0, nightlyPrice: 75_000_00, cautionDeposit: 150_000_00 },
      { mode: 'for_sale', enabled: false, price: 0 },
    ],
  },
};

const voidCandidates: VoidCandidate[] = [
  { unitId: 'ou_1', unitLabel: 'Flat 3B', propertyName: 'Lekki Phase 1 Apartments', area: 'Lekki Phase 1', vacantDays: 45, monthlyRent: 541_666_00, recommendedNightly: 75_000_00, projectedMonthlyVoidRevenue: 1_350_000_00, shortletEnabled: false },
  { unitId: 'ou_2', unitLabel: 'Studio 2', propertyName: 'Yaba Studios', area: 'Yaba', vacantDays: 21, monthlyRent: 100_000_00, recommendedNightly: 22_000_00, projectedMonthlyVoidRevenue: 396_000_00, shortletEnabled: false, longTermConflict: true },
];

// ── Real-path helpers ────────────────────────────────────────────────────────
async function getOrCreatePortfolio(supabase: any, ownerId: string): Promise<string> {
  const { data: existing } = await supabase.from('realtor_portfolios').select('id').eq('owner_id', ownerId).limit(1).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase.from('realtor_portfolios').insert({ owner_id: ownerId, name: 'My Portfolio' }).select('id').single();
  if (error) throw error;
  return data.id;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getOwnerDashboard(): Promise<OwnerDashboard> {
  if (USE_MOCK) {
    await delay();
    return {
      metrics: [
        { key: 'collected', label: 'Rent collected (mo)', value: '₦4.05M', tone: 'success' },
        { key: 'occupancy', label: 'Occupancy', value: '80%', tone: 'neutral' },
        { key: 'void', label: 'Void rate', value: '20%', tone: 'warning', hint: '2 units vacant' },
        { key: 'arrears', label: 'Arrears', value: '₦150k', tone: 'error' },
        { key: 'deposits', label: 'Deposits in escrow', value: '₦1.46M', tone: 'neutral' },
        { key: 'payout', label: 'Pending payout', value: '₦3.9M', tone: 'success' },
        { key: 'maintenance', label: 'Maintenance (mo)', value: '₦220k', tone: 'neutral' },
        { key: 'noi', label: 'Net income (mo)', value: '₦3.68M', tone: 'success' },
      ],
      properties,
      voidCandidateCount: voidCandidates.filter((v) => !v.shortletEnabled).length,
    };
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('realtor_owner_dashboard');
  if (error) throw error;
  const total = Number(data.totalUnits ?? 0);
  const occ = Number(data.occupiedUnits ?? 0);
  const occPct = total ? Math.round((occ / total) * 100) : 0;
  return {
    metrics: [
      { key: 'occupancy', label: 'Occupancy', value: `${occPct}%`, tone: 'neutral' },
      { key: 'void', label: 'Void rate', value: `${100 - occPct}%`, tone: 'warning', hint: `${total - occ} units vacant` },
      { key: 'deposits', label: 'Deposits in escrow', value: formatNaira(Number(data.depositsHeld ?? 0)), tone: 'neutral' },
      { key: 'units', label: 'Total units', value: String(total), tone: 'neutral' },
    ],
    properties: (data.properties ?? []).map((p: any) => ({
      id: p.id, name: p.name, area: p.area, city: p.city, coverUrl: '',
      unitCount: Number(p.unitCount ?? 0), occupiedCount: Number(p.occupiedCount ?? 0),
      monthlyRent: 0, arrears: 0,
    })),
    voidCandidateCount: Number(data.voidCandidateCount ?? 0),
  };
}

export async function createProperty(draft: CreatePropertyDraft): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay(520);
    const id = `op_${Date.now().toString(36)}`;
    properties.unshift({ id, name: draft.name, area: draft.area, city: draft.city, coverUrl: IMG(id), unitCount: 0, occupiedCount: 0, monthlyRent: 0, arrears: 0 });
    return { id };
  }
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const portfolioId = await getOrCreatePortfolio(supabase, user.id);
  const { data, error } = await supabase.from('realtor_properties').insert({
    portfolio_id: portfolioId, name: draft.name, property_type: draft.type,
    address: draft.address, area: draft.area, city: draft.city, state: draft.state,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id };
}

export async function createUnit(draft: CreateUnitDraft): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay(480);
    const id = `ou_${Date.now().toString(36)}`;
    unitOfferings[id] = {
      unitId: id, unitLabel: draft.label, status: 'vacant',
      modes: [
        { mode: 'long_rent', enabled: true, price: 0, rentSchedule: 'annual', cautionDeposit: 0 },
        { mode: 'short_stay', enabled: false, price: 0, nightlyPrice: 0, cautionDeposit: 0 },
        { mode: 'for_sale', enabled: false, price: 0 },
      ],
    };
    const prop = properties.find((p) => p.id === draft.propertyId);
    if (prop) prop.unitCount += 1;
    return { id };
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_units').insert({
    property_id: draft.propertyId, label: draft.label, property_type: draft.propertyType,
    bedrooms: draft.bedrooms, bathrooms: draft.bathrooms, toilets: draft.toilets,
    furnishing: draft.furnishing, status: 'vacant',
  }).select('id').single();
  if (error) throw error;
  return { id: data.id };
}

const DEFAULT_MODES: OfferingModeConfig[] = [
  { mode: 'long_rent', enabled: true, price: 0, rentSchedule: 'annual', cautionDeposit: 0 },
  { mode: 'short_stay', enabled: false, price: 0, nightlyPrice: 0, cautionDeposit: 0 },
  { mode: 'for_sale', enabled: false, price: 0 },
];

export async function getUnitOfferings(unitId: string): Promise<UnitOfferings> {
  if (USE_MOCK) { await delay(220); return unitOfferings[unitId] ?? unitOfferings.ou_1; }
  const supabase = createSupabaseClient();
  const { data: unit, error: uErr } = await supabase.from('realtor_units').select('label, status').eq('id', unitId).maybeSingle();
  if (uErr) throw uErr;
  const { data: rows, error } = await supabase.from('realtor_offering_modes').select('*').eq('unit_id', unitId);
  if (error) throw error;
  const byMode = new Map((rows ?? []).map((r: any) => [r.mode, r]));
  const modes: OfferingModeConfig[] = DEFAULT_MODES.map((d) => {
    const r: any = byMode.get(d.mode);
    return r
      ? { mode: d.mode, enabled: r.enabled, price: Number(r.price_kobo ?? 0), rentSchedule: r.rent_schedule ?? undefined, nightlyPrice: r.nightly_kobo != null ? Number(r.nightly_kobo) : undefined, cautionDeposit: r.caution_kobo != null ? Number(r.caution_kobo) : undefined }
      : d;
  });
  return { unitId, unitLabel: unit?.label ?? 'Unit', status: unit?.status ?? 'vacant', modes };
}

export async function saveUnitOfferings(unitId: string, modes: OfferingModeConfig[]): Promise<UnitOfferings> {
  if (USE_MOCK) {
    await delay(420);
    const existing = unitOfferings[unitId] ?? unitOfferings.ou_1;
    const updated: UnitOfferings = { ...existing, modes };
    unitOfferings[unitId] = updated;
    return updated;
  }
  const supabase = createSupabaseClient();
  const payload = modes.map((m) => ({
    unit_id: unitId, mode: m.mode, enabled: m.enabled, price_kobo: m.price,
    rent_schedule: m.rentSchedule ?? null, nightly_kobo: m.nightlyPrice ?? null, caution_kobo: m.cautionDeposit ?? null,
  }));
  const { error } = await supabase.from('realtor_offering_modes').upsert(payload, { onConflict: 'unit_id,mode' });
  if (error) throw error;
  // Mark the unit listed once any mode is enabled.
  if (modes.some((m) => m.enabled)) {
    await supabase.from('realtor_units').update({ status: 'listed' }).eq('id', unitId);
  }
  return getUnitOfferings(unitId);
}

export async function getVoidCandidates(): Promise<VoidCandidate[]> {
  if (USE_MOCK) { await delay(260); return [...voidCandidates]; }
  const supabase = createSupabaseClient();
  // Vacant units in the owner's portfolios, with their long-rent offering for the projection.
  const { data, error } = await supabase
    .from('realtor_units')
    .select(`id, label, status, property:realtor_properties!property_id(name, area, portfolio:realtor_portfolios!portfolio_id(owner_id)), offering:realtor_offering_modes(mode, price_kobo, nightly_kobo, enabled)`)
    .eq('status', 'vacant');
  if (error) throw error;
  const { data: { user } } = await supabase.auth.getUser();
  return (data ?? [])
    .filter((u: any) => u.property?.portfolio?.owner_id === user?.id)
    .map((u: any) => {
      const longRent = (u.offering ?? []).find((o: any) => o.mode === 'long_rent');
      const shortStay = (u.offering ?? []).find((o: any) => o.mode === 'short_stay');
      const annual = Number(longRent?.price_kobo ?? 0);
      const nightly = Number(shortStay?.nightly_kobo ?? Math.round(annual / 365 * 1.5)) || 0;
      return {
        unitId: u.id, unitLabel: u.label, propertyName: u.property?.name ?? '', area: u.property?.area ?? '',
        vacantDays: 30, monthlyRent: Math.round(annual / 12), recommendedNightly: nightly,
        projectedMonthlyVoidRevenue: nightly * 18, shortletEnabled: Boolean(shortStay?.enabled),
      } as VoidCandidate;
    });
}

export async function setVoidShortlet(unitId: string, enabled: boolean): Promise<VoidCandidate> {
  if (USE_MOCK) {
    await delay(420);
    const c = voidCandidates.find((v) => v.unitId === unitId);
    if (!c) throw new Error('Unit not found');
    c.shortletEnabled = enabled;
    const off = unitOfferings[unitId];
    if (off) off.modes = off.modes.map((m) => (m.mode === 'short_stay' ? { ...m, enabled } : m));
    return c;
  }
  const supabase = createSupabaseClient();
  const { error } = await supabase.from('realtor_offering_modes')
    .upsert({ unit_id: unitId, mode: 'short_stay', enabled }, { onConflict: 'unit_id,mode' });
  if (error) throw error;
  const candidates = await getVoidCandidates();
  const found = candidates.find((c) => c.unitId === unitId);
  if (!found) throw new Error('Unit not found');
  return found;
}
