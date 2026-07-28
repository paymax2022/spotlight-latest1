// ── Spotlight Realtor — Lease / payment / move-in data layer (V2) ────────────
// Mock by default (REALTOR_USE_MOCK). Real branch hits Supabase tables in
// supabase/migrations/20260620010000 + atomic RPCs in 20260620020000:
//   realtor_sign_lease, realtor_pay_invoice (idempotent money path).

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import type {
  Lease,
  SignLeaseDraft,
  RentInvoice,
  PayInvoiceDraft,
  PaymentReceipt,
  EscrowDeposit,
  MoveIn,
} from '../types/realtor.lease.types';
import { newIdempotencyKey } from '../utils/realtorFormatters';

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Row mappers (snake → domain) ─────────────────────────────────────────────
function mapLeaseRow(row: any, invoiceId?: string): Lease {
  return {
    id: row.id,
    applicationId: row.application_id,
    listingId: row.listing_id,
    listingTitle: row.listing?.title ?? 'Property',
    area: row.listing?.area ?? '',
    city: row.listing?.city ?? '',
    status: row.status,
    rentSchedule: row.rent_schedule,
    rent: Number(row.rent_kobo ?? 0),
    cautionDeposit: Number(row.caution_kobo ?? 0),
    serviceCharge: row.service_charge_kobo != null ? Number(row.service_charge_kobo) : undefined,
    startDate: row.start_date,
    endDate: row.end_date,
    clauses: Array.isArray(row.clauses) ? row.clauses : [],
    tenantSigned: Boolean(row.tenant_signed),
    landlordSigned: Boolean(row.landlord_signed),
    signedAt: row.signed_at ?? undefined,
    invoiceId,
  };
}

function mapInvoiceRow(row: any): RentInvoice {
  return {
    id: row.id,
    leaseId: row.lease_id,
    listingTitle: row.listing_title ?? row.listing?.title ?? 'Property',
    status: row.status,
    lines: (Array.isArray(row.lines) ? row.lines : []).map((l: any) => ({
      label: l.label, amount: Number(l.amount_kobo ?? l.amount ?? 0), refundable: l.refundable,
    })),
    total: Number(row.total_kobo ?? 0),
    dueDate: row.due_date,
    paidAt: row.paid_at ?? undefined,
  };
}

// area/city live on the property (via unit); the lease summary only needs the
// title, so we keep the join shallow. A realtor_lease_view can denormalise
// area/city in production if richer lease cards are needed.
const LEASE_SELECT = `*, listing:realtor_listings!listing_id(title)`;

async function loadInvoiceId(supabase: any, leaseId: string): Promise<string | undefined> {
  const { data } = await supabase.from('realtor_invoices').select('id').eq('lease_id', leaseId).maybeSingle();
  return data?.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock store (default path)
// ─────────────────────────────────────────────────────────────────────────────
const leases: Record<string, Lease> = {};
const invoices: Record<string, RentInvoice> = {};
const escrows: Record<string, EscrowDeposit> = {};
const moveIns: Record<string, MoveIn> = {};

function seedLease(applicationId: string): Lease {
  const id = `lease_${applicationId}`;
  if (leases[id]) return leases[id];
  const rent = 6_500_000_00;
  const deposit = 650_000_00;
  const service = 800_000_00;
  const lease: Lease = {
    id, applicationId, listingId: 'ls_001',
    listingTitle: '3-Bedroom Serviced Apartment, Lekki Phase 1',
    area: 'Lekki Phase 1', city: 'Lagos',
    status: 'awaiting_tenant_signature', rentSchedule: 'annual',
    rent, cautionDeposit: deposit, serviceCharge: service,
    startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 372 * 86_400_000).toISOString().slice(0, 10),
    tenantSigned: false, landlordSigned: true,
    clauses: [
      { heading: '1. Term', body: 'This tenancy runs for 12 months from the start date and may be renewed by mutual agreement at least 30 days before expiry.' },
      { heading: '2. Rent', body: 'Annual rent is payable in advance. Service charge covers estate security, waste and common-area maintenance.' },
      { heading: '3. Caution deposit', body: 'A refundable caution deposit is held in escrow and returned within 14 days of a clean move-out inspection, less any agreed deductions.' },
      { heading: '4. Use & care', body: 'The premises shall be used as a private residence. The tenant shall keep the premises in good condition, fair wear and tear excepted.' },
      { heading: '5. Repairs', body: 'Structural repairs are the landlord’s responsibility; minor maintenance under ₦20,000 is the tenant’s. Report issues via the app.' },
    ],
  };
  leases[id] = lease;
  return lease;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getLeaseByApplication(applicationId: string): Promise<Lease> {
  if (USE_MOCK) { await delay(); return seedLease(applicationId); }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_leases').select(LEASE_SELECT)
    .eq('application_id', applicationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Lease not found');
  return mapLeaseRow(data, await loadInvoiceId(supabase, data.id));
}

export async function getLease(id: string): Promise<Lease> {
  if (USE_MOCK) {
    await delay(200);
    return Object.values(leases).find((l) => l.id === id) ?? seedLease(id.replace('lease_', ''));
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_leases').select(LEASE_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Lease not found');
  return mapLeaseRow(data, await loadInvoiceId(supabase, data.id));
}

export async function signLease(draft: SignLeaseDraft): Promise<Lease> {
  if (USE_MOCK) {
    await delay(520);
    const lease = leases[draft.leaseId] ?? (await getLease(draft.leaseId));
    lease.tenantSigned = true; lease.status = 'signed'; lease.signedAt = new Date().toISOString();
    const invId = `inv_${lease.id}`;
    lease.invoiceId = invId;
    invoices[invId] = {
      id: invId, leaseId: lease.id, listingTitle: lease.listingTitle, status: 'pending',
      dueDate: lease.startDate,
      lines: [
        { label: 'Annual rent', amount: lease.rent },
        { label: 'Caution deposit', amount: lease.cautionDeposit, refundable: true },
        ...(lease.serviceCharge ? [{ label: 'Service charge', amount: lease.serviceCharge }] : []),
      ],
      total: lease.rent + lease.cautionDeposit + (lease.serviceCharge ?? 0),
    };
    return lease;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('realtor_sign_lease', {
    p_lease_id: draft.leaseId, p_signature: draft.signatureName,
  });
  if (error) throw error;
  return mapLeaseRow(data.lease, data.invoice_id);
}

export async function getInvoice(id: string): Promise<RentInvoice> {
  if (USE_MOCK) {
    await delay(220);
    const inv = invoices[id];
    if (!inv) throw new Error('Invoice not found');
    return inv;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_invoices')
    .select(`*, listing:realtor_leases!lease_id(listing:realtor_listings!listing_id(title))`)
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Invoice not found');
  return mapInvoiceRow({ ...data, listing_title: data.listing?.listing?.title });
}

export async function payInvoice(draft: PayInvoiceDraft): Promise<PaymentReceipt> {
  if (USE_MOCK) {
    await delay(700);
    const inv = invoices[draft.invoiceId];
    if (!inv) throw new Error('Invoice not found');
    inv.status = 'paid'; inv.paidAt = new Date().toISOString();
    const deposit = inv.lines.filter((l) => l.refundable).reduce((s, l) => s + l.amount, 0);
    const lease = leases[inv.leaseId];
    if (lease) {
      lease.status = 'active';
      escrows[lease.id] = {
        id: `esc_${lease.id}`, leaseId: lease.id, amount: deposit, status: 'held',
        heldSince: new Date().toISOString(),
        releaseCondition: 'Released within 14 days of a clean move-out inspection.',
      };
      moveIns[lease.id] = {
        leaseId: lease.id, keysHandedOver: false, occupancyActivated: false,
        checklist: [
          { id: 'mi_meter', label: 'Record prepaid meter reading', done: false },
          { id: 'mi_water', label: 'Confirm water & plumbing working', done: false },
          { id: 'mi_keys', label: 'Collect keys & access cards', done: false },
          { id: 'mi_photos', label: 'Take move-in condition photos', done: false },
        ],
      };
    }
    return {
      id: `rcpt_${Date.now().toString(36)}`, invoiceId: inv.id, status: 'paid', amount: inv.total,
      channel: draft.channel, reference: newIdempotencyKey().toUpperCase(),
      paidAt: inv.paidAt, escrowHeld: deposit,
    };
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('realtor_pay_invoice', {
    p_invoice_id: draft.invoiceId, p_channel: draft.channel, p_idempotency_key: newIdempotencyKey(),
  });
  if (error) throw error;
  return {
    id: data.id, invoiceId: data.invoice_id, status: data.status, amount: Number(data.amount),
    channel: draft.channel, reference: data.reference, paidAt: data.paid_at,
    escrowHeld: Number(data.escrow_held ?? 0),
  };
}

export async function getEscrow(leaseId: string): Promise<EscrowDeposit | null> {
  if (USE_MOCK) { await delay(180); return escrows[leaseId] ?? null; }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_escrow_deposits')
    .select('*').eq('lease_id', leaseId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id, leaseId: data.lease_id, amount: Number(data.amount_kobo), status: data.status,
    heldSince: data.held_since, releaseCondition: data.release_condition ?? '',
  };
}

function mapMoveInRow(row: any): MoveIn {
  const checklist = Array.isArray(row.checklist) ? row.checklist : [];
  return {
    leaseId: row.lease_id,
    checklist,
    keysHandedOver: Boolean(row.keys_handed_over),
    occupancyActivated: Boolean(row.occupancy_activated),
  };
}

export async function getMoveIn(leaseId: string): Promise<MoveIn> {
  if (USE_MOCK) {
    await delay(200);
    const mi = moveIns[leaseId];
    if (!mi) throw new Error('Move-in not available yet');
    return mi;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_move_ins').select('*').eq('lease_id', leaseId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Move-in not available yet');
  return mapMoveInRow(data);
}

export async function toggleMoveInItem(leaseId: string, itemId: string): Promise<MoveIn> {
  if (USE_MOCK) {
    await delay(120);
    const mi = moveIns[leaseId];
    if (!mi) throw new Error('Move-in not available');
    mi.checklist = mi.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
    mi.keysHandedOver = mi.checklist.find((c) => c.id === 'mi_keys')?.done ?? false;
    return mi;
  }
  const supabase = createSupabaseClient();
  const current = await getMoveIn(leaseId);
  const checklist = current.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
  const keys = checklist.find((c) => c.id === 'mi_keys')?.done ?? false;
  const { data, error } = await supabase.from('realtor_move_ins')
    .update({ checklist, keys_handed_over: keys }).eq('lease_id', leaseId).select('*').single();
  if (error) throw error;
  return mapMoveInRow(data);
}

export async function activateOccupancy(leaseId: string): Promise<MoveIn> {
  if (USE_MOCK) {
    await delay(420);
    const mi = moveIns[leaseId];
    if (!mi) throw new Error('Move-in not available');
    mi.occupancyActivated = true;
    return mi;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_move_ins')
    .update({ occupancy_activated: true, activated_at: new Date().toISOString() })
    .eq('lease_id', leaseId).select('*').single();
  if (error) throw error;
  return mapMoveInRow(data);
}
