// Estate Property management (Block 38) — types + dual mock/live api + constants.
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

export const USE_MOCK = (process.env.EXPO_PUBLIC_PROPERTIES_USE_MOCK ?? 'true') !== 'false';
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

export async function listProperties(): Promise<PropertiesResponse> {
  if (USE_MOCK) { await latency(); return { summary: summarize(mockProperties), properties: mockProperties.slice() }; }
  const { data } = await api.get<PropertiesResponse>(PROPERTIES_API_BASE); return data;
}
