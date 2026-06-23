import {
  Network,
  DataPlan,
  Disco,
  MeterValidation,
  CableProvider,
  CablePackage,
  SmartCardValidation,
} from '@/types/billing';
import { Colors } from '@/constants/colors';

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const NETWORK_COLORS: Record<string, { accent: string; bg: string }> = {
  MTN:     { accent: '#F5B800', bg: 'rgba(245,184,0,0.12)' },
  AIRTEL:  { accent: '#E11D48', bg: 'rgba(225,29,72,0.10)' },
  GLO:     { accent: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
  '9MOBILE':{ accent: '#84CC16', bg: 'rgba(132,204,22,0.12)' },
  DEFAULT: { accent: Colors.primary, bg: Colors.iconBgPurple },
};

export function mapNetworkFromApi(raw: unknown): Network {
  const r    = asRecord(raw);
  const name = String(r.name ?? '').toUpperCase();
  const clr  = NETWORK_COLORS[name] ?? NETWORK_COLORS.DEFAULT;
  return {
    id:       String(r.id ?? ''),
    name:     String(r.name ?? ''),
    code:     String(r.code ?? ''),
    logoUrl:  r.logoUrl ? String(r.logoUrl) : r.logo_url ? String(r.logo_url) : undefined,
    isActive: Boolean(r.isActive ?? r.is_active ?? true),
    accent:   clr.accent,
    bg:       clr.bg,
  };
}

export function mapNetworksFromApi(raw: unknown): Network[] {
  return asArray(raw).map(mapNetworkFromApi);
}

export function mapDataPlanFromApi(raw: unknown): DataPlan {
  const r = asRecord(raw);
  return {
    id:           String(r.id ?? ''),
    networkCode:  String(r.networkCode ?? r.network_code ?? ''),
    name:         String(r.name ?? ''),
    allowance:    String(r.allowance ?? ''),
    validity:     String(r.validity ?? ''),
    sellingPrice: Number(r.sellingPrice ?? r.selling_price ?? 0),
    providerCode: String(r.providerCode ?? r.provider_code ?? ''),
    isActive:     Boolean(r.isActive ?? r.is_active ?? true),
  };
}

export function mapDataPlansFromApi(raw: unknown): DataPlan[] {
  return asArray(raw).map(mapDataPlanFromApi);
}

export function mapDiscoFromApi(raw: unknown): Disco {
  const r = asRecord(raw);
  return {
    id:              String(r.id ?? ''),
    name:            String(r.name ?? ''),
    code:            String(r.code ?? ''),
    supportsPrepaid: Boolean(r.supportsPrepaid ?? r.supports_prepaid ?? true),
    supportsPostpaid:Boolean(r.supportsPostpaid ?? r.supports_postpaid ?? true),
    isActive:        Boolean(r.isActive ?? r.is_active ?? true),
  };
}

export function mapDiscosFromApi(raw: unknown): Disco[] {
  return asArray(raw).map(mapDiscoFromApi);
}

export function mapMeterValidationFromApi(raw: unknown): MeterValidation {
  const r = asRecord(raw);
  return {
    customerName:    String(r.customerName ?? r.customer_name ?? ''),
    customerAddress: r.customerAddress ? String(r.customerAddress) : r.customer_address ? String(r.customer_address) : undefined,
    meterNumber:     String(r.meterNumber ?? r.meter_number ?? ''),
    discoName:       String(r.discoName ?? r.disco_name ?? ''),
    minimumAmount:   r.minimumAmount != null ? Number(r.minimumAmount) : r.minimum_amount != null ? Number(r.minimum_amount) : undefined,
    maximumAmount:   r.maximumAmount != null ? Number(r.maximumAmount) : r.maximum_amount != null ? Number(r.maximum_amount) : undefined,
  };
}

export function mapCableProviderFromApi(raw: unknown): CableProvider {
  const r = asRecord(raw);
  return {
    id:       String(r.id ?? ''),
    name:     String(r.name ?? ''),
    code:     String(r.code ?? ''),
    logoUrl:  r.logoUrl ? String(r.logoUrl) : r.logo_url ? String(r.logo_url) : undefined,
    isActive: Boolean(r.isActive ?? r.is_active ?? true),
  };
}

export function mapCableProvidersFromApi(raw: unknown): CableProvider[] {
  return asArray(raw).map(mapCableProviderFromApi);
}

export function mapCablePackageFromApi(raw: unknown): CablePackage {
  const r = asRecord(raw);
  return {
    id:               String(r.id ?? ''),
    providerCode:     String(r.providerCode ?? r.provider_code ?? ''),
    name:             String(r.name ?? ''),
    duration:         String(r.duration ?? ''),
    sellingPrice:     Number(r.sellingPrice ?? r.selling_price ?? 0),
    providerCodeValue:String(r.providerCodeValue ?? r.provider_code_value ?? ''),
    isActive:         Boolean(r.isActive ?? r.is_active ?? true),
  };
}

export function mapCablePackagesFromApi(raw: unknown): CablePackage[] {
  return asArray(raw).map(mapCablePackageFromApi);
}

export function mapSmartCardValidationFromApi(raw: unknown): SmartCardValidation {
  const r = asRecord(raw);
  return {
    customerName:   String(r.customerName ?? r.customer_name ?? ''),
    smartCardNumber:String(r.smartCardNumber ?? r.smart_card_number ?? ''),
    providerName:   String(r.providerName ?? r.provider_name ?? ''),
    currentBouquet: r.currentBouquet ? String(r.currentBouquet) : r.current_bouquet ? String(r.current_bouquet) : undefined,
  };
}
