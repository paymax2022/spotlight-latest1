/**
 * Utility beneficiaries API client (BENE-1).
 *
 * Backend:
 *   GET  /api/v1/utility/beneficiaries?category=<lowercase>
 *   POST /api/v1/utility/beneficiaries  { category, biller_id, label, customer_reference, customer_name? }
 *
 * NOTE: the beneficiaries endpoints filter on the lowercase utility category
 * enum (airtime | data | electricity | cable_tv), so the mobile ServiceType
 * (AIRTIME | DATA | ELECTRICITY | CABLE_TV) must be lowercased on the wire.
 */
import { api } from '@/api/client';
import { ServiceType } from '@/types/billing';

export interface Beneficiary {
  id: string;
  category: ServiceType;
  billerId: string;
  label: string;
  customerReference: string;
  customerName?: string;
  createdAt?: string;
}

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

/** ServiceType -> backend category param (lowercase enum). */
function toCategoryParam(serviceType: ServiceType): string {
  return serviceType.toLowerCase(); // AIRTIME->airtime, CABLE_TV->cable_tv, etc.
}

/** Backend category enum -> mobile ServiceType. */
function fromCategory(raw: unknown): ServiceType {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'DATA') return 'DATA';
  if (s.includes('ELECTRIC')) return 'ELECTRICITY';
  if (s.includes('CABLE')) return 'CABLE_TV';
  return 'AIRTIME';
}

function mapBeneficiary(value: unknown): Beneficiary {
  const r = asRecord(value);
  const ref = String(r.customer_reference ?? r.customerReference ?? '');
  const name = r.customer_name ?? r.customerName;
  return {
    id: String(r.id ?? ''),
    category: fromCategory(r.category),
    billerId: String(r.biller_id ?? r.billerId ?? ''),
    label: String(r.label ?? name ?? ref),
    customerReference: ref,
    customerName: name == null ? undefined : String(name),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

export async function getBeneficiaries(serviceType: ServiceType): Promise<Beneficiary[]> {
  const response = await api.get('/api/v1/utility/beneficiaries', {
    params: { category: toCategoryParam(serviceType) },
  });
  const data = response.data?.data ?? response.data;
  const rows = Array.isArray(data?.beneficiaries) ? data.beneficiaries : Array.isArray(data) ? data : [];
  return rows.map(mapBeneficiary);
}

export async function saveBeneficiary(input: {
  serviceType: ServiceType;
  billerId: string;
  label: string;
  customerReference: string;
  customerName?: string;
}): Promise<Beneficiary> {
  const response = await api.post('/api/v1/utility/beneficiaries', {
    category: toCategoryParam(input.serviceType),
    biller_id: input.billerId,
    label: input.label,
    customer_reference: input.customerReference,
    customer_name: input.customerName,
  });
  const data = response.data?.data ?? response.data;
  return mapBeneficiary(data?.beneficiary ?? data);
}
