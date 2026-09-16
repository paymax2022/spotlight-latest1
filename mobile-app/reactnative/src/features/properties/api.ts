// Estate Property management (Block 38) — types + dual mock/live api + constants.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';

export type PropertyType = 'apartment' | 'house' | 'commercial' | 'land' | 'other';
export type OccupancyStatus = 'vacant' | 'occupied' | 'reserved';

export interface Property {
  id: string; estateId: string; unitLabel: string; propertyType: PropertyType;
  floor?: string; block?: string; occupancyStatus: OccupancyStatus;
  landlordId?: string; landlordName?: string; tenantId?: string; tenantName?: string;
}
export interface PropertySummary { total: number; occupied: number; vacant: number; reserved: number; occupancyRate: number; }
export interface PropertiesResponse { summary: PropertySummary; properties: Property[]; }

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_PROPERTIES_USE_MOCK, true);
export const PROPERTIES_API_BASE = '/api/v1/estate/properties';

export const TYPE_META: Record<PropertyType, { label: string; icon: string }> = {
  apartment:  { label: 'Apartment',  icon: 'Building' },
  house:      { label: 'House',      icon: 'Home' },
  commercial: { label: 'Commercial', icon: 'Store' },
  land:       { label: 'Land',       icon: 'Map' },
  other:      { label: 'Other',      icon: 'Square' },
};
export const OCCUPANCY_META: Record<OccupancyStatus, { label: string; color: string; bg: string }> = {
  occupied: { label: 'Occupied', color: '#16A34A',      bg: 'rgba(22,163,74,0.12)' },
  vacant:   { label: 'Vacant',   color: '#B26B00',      bg: 'rgba(245,158,11,0.12)' },
  reserved: { label: 'Reserved', color: Colors.secondary, bg: Colors.iconBgBlue },
};

const mockProperties: Property[] = [
  { id: 'p1', estateId: 'est_amber_court', unitLabel: 'A-01', propertyType: 'apartment', floor: '1', block: 'A', occupancyStatus: 'occupied', landlordName: 'Tunde Bello', tenantName: 'Ngozi Okeke' },
  { id: 'p2', estateId: 'est_amber_court', unitLabel: 'A-02', propertyType: 'apartment', floor: '1', block: 'A', occupancyStatus: 'occupied', landlordName: 'Tunde Bello', tenantName: 'Emeka Eze' },
  { id: 'p3', estateId: 'est_amber_court', unitLabel: 'B-07', propertyType: 'house', block: 'B', occupancyStatus: 'vacant', landlordName: 'Aisha Bello' },
  { id: 'p4', estateId: 'est_amber_court', unitLabel: 'C-12', propertyType: 'apartment', floor: '3', block: 'C', occupancyStatus: 'reserved', landlordName: 'Chidi Okafor' },
  { id: 'p5', estateId: 'est_amber_court', unitLabel: 'SHOP-1', propertyType: 'commercial', block: 'Gate', occupancyStatus: 'occupied', tenantName: 'BrightMart' },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function summarize(props: Property[]): PropertySummary {
  const occupied = props.filter((p) => p.occupancyStatus === 'occupied').length;
  const vacant = props.filter((p) => p.occupancyStatus === 'vacant').length;
  const reserved = props.filter((p) => p.occupancyStatus === 'reserved').length;
  const total = props.length;
  return { total, occupied, vacant, reserved, occupancyRate: total ? Math.round((occupied / total) * 100) : 0 };
}

function propFromApi(r: any): Property {
  return {
    id: r.id, estateId: r.estate_id, unitLabel: r.unit_label, propertyType: r.property_type as PropertyType,
    floor: r.floor || undefined, block: r.block || undefined, occupancyStatus: r.occupancy_status as OccupancyStatus,
    landlordId: r.landlord_id ?? undefined, tenantId: r.tenant_id ?? undefined,
  };
}

export async function listProperties(): Promise<PropertiesResponse> {
  if (USE_MOCK) { await latency(); return { summary: summarize(mockProperties), properties: mockProperties.slice() }; }
  // Backend returns a bare array of properties (archived excluded); summarise client-side.
  const res = await api.get(PROPERTIES_API_BASE);
  const rows = (res.data?.data ?? res.data ?? []) as any[];
  const properties = rows.map(propFromApi);
  return { summary: summarize(properties), properties };
}

// ── Block 29 property management ──────────────────────────────────────────────
export async function getProperty(id: string): Promise<Property> {
  if (USE_MOCK) { await latency(); const p = mockProperties.find((x) => x.id === id); if (!p) throw new Error('not found'); return { ...p }; }
  const { data } = await api.get(`${PROPERTIES_API_BASE}/${id}`); return propFromApi(data);
}
export async function updateProperty(id: string, patch: { unitLabel?: string; propertyType?: PropertyType; floor?: string; block?: string }): Promise<Property> {
  if (USE_MOCK) { await latency(); const p = mockProperties.find((x) => x.id === id); if (!p) throw new Error('not found'); return { ...p, ...patch }; }
  const { data } = await api.patch(`${PROPERTIES_API_BASE}/${id}`, { unit_label: patch.unitLabel, property_type: patch.propertyType, floor: patch.floor, block: patch.block }); return propFromApi(data);
}
export async function assignLandlord(id: string, userId: string): Promise<Property> {
  if (USE_MOCK) { await latency(); const p = mockProperties.find((x) => x.id === id)!; return { ...p, landlordId: userId }; }
  const { data } = await api.post(`${PROPERTIES_API_BASE}/${id}/landlord`, { user_id: userId }); return propFromApi(data);
}
export async function assignTenant(id: string, userId: string): Promise<Property> {
  if (USE_MOCK) { await latency(); const p = mockProperties.find((x) => x.id === id)!; return { ...p, tenantId: userId, occupancyStatus: 'occupied' }; }
  const { data } = await api.post(`${PROPERTIES_API_BASE}/${id}/tenant`, { user_id: userId }); return propFromApi(data);
}
export async function setOccupancy(id: string, status: OccupancyStatus): Promise<Property> {
  if (USE_MOCK) { await latency(); const p = mockProperties.find((x) => x.id === id)!; return { ...p, occupancyStatus: status }; }
  const { data } = await api.post(`${PROPERTIES_API_BASE}/${id}/occupancy`, { status }); return propFromApi(data);
}
export async function archiveProperty(id: string): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.post(`${PROPERTIES_API_BASE}/${id}/archive`);
}
export interface PropertyAnalytics { propertyId: string; occupancyStatus: string; openRepairs: number; totalRepairs: number; invoicedKobo: number; collectedKobo: number; outstandingKobo: number; openTransferRequests: number; }
export async function getPropertyAnalytics(id: string): Promise<PropertyAnalytics> {
  if (USE_MOCK) { await latency(); return { propertyId: id, occupancyStatus: 'occupied', openRepairs: 1, totalRepairs: 4, invoicedKobo: 900000, collectedKobo: 600000, outstandingKobo: 300000, openTransferRequests: 0 }; }
  const { data } = await api.get(`${PROPERTIES_API_BASE}/${id}/analytics`);
  return { propertyId: data.property_id, occupancyStatus: data.occupancy_status, openRepairs: Number(data.open_repairs ?? 0), totalRepairs: Number(data.total_repairs ?? 0), invoicedKobo: Number(data.invoiced_kobo ?? 0), collectedKobo: Number(data.collected_kobo ?? 0), outstandingKobo: Number(data.outstanding_kobo ?? 0), openTransferRequests: Number(data.open_transfer_requests ?? 0) };
}
export async function requestPropertyTransfer(id: string, input: { toUserId: string; transferType: 'ownership' | 'tenancy'; reason?: string }): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.post(`${PROPERTIES_API_BASE}/${id}/transfer-request`, { to_user_id: input.toUserId, transfer_type: input.transferType, reason: input.reason });
}
