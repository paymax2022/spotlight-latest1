// ── Spotlight Realtor — Admin: listing moderation (V3, slice) ────────────────
// Mock-flagged. The operations control plane lives in the admin web portal in
// production; this is a lightweight mobile moderation queue for on-call admins.

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import type { Kobo, VerificationLevel, PropertyType, TransactionMode } from '../types/realtor.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModerationDecision = 'approve' | 'reject' | 'request_changes';

export interface ModerationItem {
  id: string;
  title: string;
  area: string;
  city: string;
  coverUrl: string;
  mode: TransactionMode;
  propertyType: PropertyType;
  price: Kobo;
  verification: VerificationLevel;
  ownerName: string;
  ownerVerified: boolean;
  /** AI risk flags surfaced for the reviewer. */
  riskFlags: string[];
  submittedAt: string;
}

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
const IMG = (s: string) => `https://picsum.photos/seed/${s}/800/600`;

const queue: ModerationItem[] = [
  {
    id: 'mod_1', title: '2-Bedroom Flat, Gbagada Phase 2', area: 'Gbagada', city: 'Lagos', coverUrl: IMG('mod1'),
    mode: 'long_rent', propertyType: 'flat', price: 1_800_000_00, verification: 'unverified',
    ownerName: 'Kingsway Realty', ownerVerified: false,
    riskFlags: ['Owner not yet verified', 'No ownership document uploaded'], submittedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
  },
  {
    id: 'mod_2', title: 'Studio Apartment, Surulere', area: 'Surulere', city: 'Lagos', coverUrl: IMG('mod2'),
    mode: 'long_rent', propertyType: 'studio', price: 900_000_00, verification: 'document_backed',
    ownerName: 'Bola Adeyemi', ownerVerified: true,
    riskFlags: ['Possible duplicate of listing #4821'], submittedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
  },
  {
    id: 'mod_3', title: '4-Bed Duplex, Maitama (Off-plan)', area: 'Maitama', city: 'Abuja', coverUrl: IMG('mod3'),
    mode: 'for_sale', propertyType: 'duplex', price: 280_000_000_00, verification: 'document_backed',
    ownerName: 'Citadel Developments', ownerVerified: true,
    riskFlags: [], submittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

export async function getModerationQueue(): Promise<ModerationItem[]> {
  if (USE_MOCK) { await delay(); return [...queue]; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('realtor_listings')
    .select(`id, title, mode, verification, price_kobo, media, created_at,
             unit:realtor_units!unit_id(property_type, property:realtor_properties!property_id(area, city)),
             agent:user_profiles!agent_id(full_name)`)
    .eq('status', 'pending_verification')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    area: r.unit?.property?.area ?? '',
    city: r.unit?.property?.city ?? '',
    coverUrl: Array.isArray(r.media) ? (r.media[0] ?? '') : '',
    mode: r.mode,
    propertyType: r.unit?.property_type ?? 'apartment',
    price: Number(r.price_kobo ?? 0),
    verification: r.verification,
    ownerName: r.agent?.full_name ?? 'Owner',
    ownerVerified: r.verification === 'verified',
    riskFlags: r.verification === 'unverified' ? ['Owner not yet verified'] : [],
    submittedAt: r.created_at,
  }));
}

export async function decideModeration(id: string, decision: ModerationDecision): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay(360);
    const idx = queue.findIndex((q) => q.id === id);
    if (idx >= 0) queue.splice(idx, 1);   // remove from queue once actioned
    return { id };
  }
  const supabase = createSupabaseClient();
  const status = decision === 'approve' ? 'published' : decision === 'reject' ? 'suspended' : 'draft';
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (decision === 'approve') patch.verification = 'verified';
  const { error } = await supabase.from('realtor_listings').update(patch).eq('id', id);
  if (error) throw error;
  return { id };
}
