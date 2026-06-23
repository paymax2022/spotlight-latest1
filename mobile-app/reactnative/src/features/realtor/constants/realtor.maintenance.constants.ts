// ── Spotlight Realtor — Maintenance labels / icons / status presentation ─────
import type { MaintenanceCategory, Urgency, MaintenanceStatus } from '../types/realtor.maintenance.types';
import type { Tone } from '../components/StatusBadge';

export const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', ac_hvac: 'AC / HVAC', generator: 'Generator / power',
  water: 'Water supply', roof_leak: 'Roof / leakage', door_lock: 'Door / lock', appliance: 'Appliance',
  pest: 'Pest control', painting: 'Painting', furniture: 'Furniture', internet: 'Internet',
  security: 'Security system', structural: 'Structural', cleaning: 'Cleaning', other: 'Other',
};

export const CATEGORY_ICON: Record<MaintenanceCategory, string> = {
  plumbing: 'Wrench', electrical: 'Zap', ac_hvac: 'Wind', generator: 'Fuel', water: 'Droplets',
  roof_leak: 'CloudRain', door_lock: 'Lock', appliance: 'WashingMachine', pest: 'Bug', painting: 'Paintbrush',
  furniture: 'Armchair', internet: 'Wifi', security: 'ShieldCheck', structural: 'Hammer', cleaning: 'Sparkles', other: 'Wrench',
};

export const CATEGORY_OPTIONS: MaintenanceCategory[] = [
  'plumbing', 'electrical', 'ac_hvac', 'generator', 'water', 'roof_leak',
  'door_lock', 'appliance', 'pest', 'painting', 'furniture', 'internet',
  'security', 'structural', 'cleaning', 'other',
];

export const URGENCY_META: Record<Urgency, { label: string; tone: Tone; hint: string }> = {
  low: { label: 'Low', tone: 'neutral', hint: 'Can wait a week or two' },
  normal: { label: 'Normal', tone: 'info', hint: 'Within a few days' },
  high: { label: 'High', tone: 'warning', hint: 'Needs attention soon' },
  emergency: { label: 'Emergency', tone: 'error', hint: 'Safety risk — bypasses approval' },
};

export const URGENCY_OPTIONS: Urgency[] = ['low', 'normal', 'high', 'emergency'];

export const MAINT_STATUS_META: Record<MaintenanceStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  manager_review: { label: 'Under review', tone: 'warning' },
  vendor_assigned: { label: 'Vendor assigned', tone: 'info' },
  quote_submitted: { label: 'Quote received', tone: 'warning' },
  quote_approved: { label: 'Quote approved', tone: 'success' },
  quote_rejected: { label: 'Quote rejected', tone: 'error' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Work completed', tone: 'success' },
  tenant_confirmed: { label: 'Confirmed', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'error' },
};
