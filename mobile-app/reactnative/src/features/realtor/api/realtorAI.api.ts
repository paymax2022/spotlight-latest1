// ── Spotlight Realtor — AI listing assistant (V3) ────────────────────────────
// Mock-flagged. In production this calls the LLM service (Claude) with a clean
// prompt/tool boundary and returns structured output. The mock mirrors that
// structured shape so the screen is identical when the real call lands.

import { api } from '@/api/client';
import { REALTOR_USE_MOCK } from './realtorEnv';
import type { Kobo, PropertyType, Amenity } from '../types/realtor.types';
import { PROPERTY_TYPE_LABEL, AMENITY_LABEL } from '../constants/realtor.constants';

export interface ListingCopyRequest {
  propertyType: PropertyType;
  area: string;
  bedrooms: number;
  bathrooms: number;
  amenities: Amenity[];
  highlights?: string;        // free-text the owner adds
}

export interface ListingCopySuggestion {
  title: string;
  description: string;
  tags: string[];
  /** AI price recommendation band from comparable demand signal (minor units). */
  priceLow: Kobo;
  priceHigh: Kobo;
  rationale: string;
}

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 900) => new Promise((r) => setTimeout(r, ms));

export async function generateListingCopy(req: ListingCopyRequest): Promise<ListingCopySuggestion> {
  if (USE_MOCK) {
    await delay();
    const type = PROPERTY_TYPE_LABEL[req.propertyType];
    const bedLabel = req.bedrooms > 0 ? `${req.bedrooms}-bedroom` : 'studio';
    const amenityPhrase = req.amenities.slice(0, 4).map((a) => AMENITY_LABEL[a].toLowerCase()).join(', ');
    const base = 1_500_000_00 + req.bedrooms * 1_200_000_00;
    return {
      title: `${bedLabel.charAt(0).toUpperCase() + bedLabel.slice(1)} ${type} in ${req.area}`,
      description:
        `Welcome to this beautifully presented ${bedLabel} ${type.toLowerCase()} in the heart of ${req.area}. ` +
        `With ${req.bedrooms} bedroom${req.bedrooms === 1 ? '' : 's'} and ${req.bathrooms} bathroom${req.bathrooms === 1 ? '' : 's'}, ` +
        `it offers comfortable, modern living` +
        (amenityPhrase ? ` complete with ${amenityPhrase}.` : '.') +
        (req.highlights ? ` ${req.highlights.trim()}` : '') +
        ` Close to schools, markets and major roads — an ideal choice for families and professionals alike.`,
      tags: [type, `${req.bedrooms} bed`, req.area, ...req.amenities.slice(0, 3).map((a) => AMENITY_LABEL[a])],
      priceLow: Math.round(base * 0.9),
      priceHigh: Math.round(base * 1.15),
      rationale: `Based on ${req.bedrooms}-bed ${type.toLowerCase()} listings in ${req.area} over the last 90 days, adjusted for the amenities you selected.`,
    };
  }
  // Real path: the Next.js route proxies to Claude server-side (the API key
  // never touches the client). Same structured shape as the mock.
  const res = await api.post('/api/v1/realtor/ai/listing-copy', req);
  const data = (res.data?.data ?? res.data) as ListingCopySuggestion;
  return data;
}

// ── Maintenance triage ───────────────────────────────────────────────────────
import type { MaintenanceCategory, Urgency } from '../types/realtor.maintenance.types';

export interface TriageResult {
  suggestedCategory: MaintenanceCategory;
  suggestedUrgency: Urgency;
  summary: string;
}

const EMERGENCY_HINTS = ['gas', 'fire', 'flood', 'sparking', 'electric shock', 'smoke', 'burst', 'no water', 'sewage'];
const CATEGORY_HINTS: [MaintenanceCategory, string[]][] = [
  ['plumbing', ['leak', 'tap', 'sink', 'toilet', 'pipe', 'drain', 'water']],
  ['electrical', ['light', 'socket', 'power', 'wiring', 'breaker', 'spark']],
  ['ac_hvac', ['ac', 'air condition', 'cooling', 'hvac']],
  ['generator', ['generator', 'gen ', 'fuel']],
  ['roof_leak', ['roof', 'ceiling', 'leakage']],
  ['door_lock', ['door', 'lock', 'key', 'handle']],
  ['appliance', ['fridge', 'washing', 'cooker', 'microwave', 'appliance']],
  ['pest', ['rat', 'roach', 'pest', 'insect', 'termite']],
];

export async function triageMaintenance(description: string, fallback: MaintenanceCategory): Promise<TriageResult> {
  if (USE_MOCK) {
    await delay(700);
    const d = description.toLowerCase();
    const cat = CATEGORY_HINTS.find(([, hints]) => hints.some((h) => d.includes(h)))?.[0] ?? fallback;
    const urgency: Urgency = EMERGENCY_HINTS.some((h) => d.includes(h)) ? 'emergency' : d.includes('urgent') || d.includes('not working') ? 'high' : 'normal';
    return { suggestedCategory: cat, suggestedUrgency: urgency, summary: `Looks like a ${cat.replace('_', ' ')} issue. Suggested priority: ${urgency}.` };
  }
  const res = await api.post('/api/v1/realtor/ai/assist', { task: 'maintenance_triage', input: { description, fallback } });
  return (res.data?.data ?? res.data) as TriageResult;
}

// ── Dynamic shortlet pricing ─────────────────────────────────────────────────
export interface PricingSuggestion { nightlyLow: Kobo; nightlyHigh: Kobo; rationale: string; }

export async function suggestShortletPrice(area: string, bedrooms: number): Promise<PricingSuggestion> {
  if (USE_MOCK) {
    await delay(700);
    const base = 35_000_00 + bedrooms * 20_000_00;
    return { nightlyLow: Math.round(base * 0.85), nightlyHigh: Math.round(base * 1.25), rationale: `Based on ${bedrooms}-bed short-stays in ${area || 'the area'} and current demand/seasonality.` };
  }
  const res = await api.post('/api/v1/realtor/ai/assist', { task: 'shortlet_pricing', input: { area, bedrooms } });
  return (res.data?.data ?? res.data) as PricingSuggestion;
}
