// Doctor onboarding approval (admin). Live backend only - there is no fixture
// mode: GET/POST /api/v1/telemedicine/admin/onboarding/applications[...], gated by
// telemedicine.admin.view (reads) and telemedicine.admin.manage (decision). Shapes
// follow contracts/telemedicine-admin-onboarding.openapi.yaml.

import { apiV1 } from '@/config/env';

export type OnboardingStage =
  | 'started' | 'type_selected' | 'in_progress' | 'pending_review'
  | 'needs_info' | 'approved' | 'rejected' | 'suspended';

export const ONBOARDING_STAGES: { value: OnboardingStage; label: string }[] = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'needs_info', label: 'Needs info' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'type_selected', label: 'Type selected' },
  { value: 'started', label: 'Started' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

export interface OnboardingApplication {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  provider_type: string;
  selected_type: string | null;
  stage: OnboardingStage;
  upgrade_state: string | null;
  verification_status: string | null;
  verification_id: string | null;
  mdcn_number: string | null;
  consents_accepted: number;
  consents_required: number;
  permissions_granted: number;
  steps_completed: number;
  submitted_at: string | null;
  updated_at: string;
}

export interface OnboardingList {
  items: OnboardingApplication[];
  total: number;
  counts: Record<string, number>;
}

export interface OnboardingConsent { kind: string; version: string; accepted: boolean; accepted_at: string | null }
export interface OnboardingPermission { kind: string; state: string; decided_at: string | null }
export interface OnboardingVerification {
  id: string; status: string; kind: string; mdcn_number: string | null; discipline: string | null;
  licence_expiry: string | null; submitted_at: string | null; decided_at: string | null;
  notes: string | null; rejection_reason: string | null;
}
export interface OnboardingDocument {
  id: string; doc_type: string; label: string | null; file_name: string | null; mime_type: string | null;
  size_bytes: number | null; required: boolean; uploaded_at: string;
}
export interface OnboardingAuditEntry {
  id: string; action: string; actor_id: string; created_at: string; detail: Record<string, unknown>;
}

export interface OnboardingDetail extends OnboardingApplication {
  specialty: string | null;
  hospital: string | null;
  is_published: boolean;
  completed_steps: string[];
  consents: OnboardingConsent[];
  permissions: OnboardingPermission[];
  verifications: OnboardingVerification[];
  documents: OnboardingDocument[];
  audit: OnboardingAuditEntry[];
  can_decide: boolean;
  review_path: string;
}

export type OnboardingAction = 'approve' | 'need_info' | 'reject';

export interface OnboardingDecisionInput {
  action: OnboardingAction;
  licence_expiry?: string;
  discipline?: 'medical' | 'dental';
  notes?: string;
}

function base(): string {
  return `${apiV1()}/telemedicine/admin/onboarding/applications`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep default */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function listOnboarding(opts: { stage?: string; q?: string; limit?: number; offset?: number } = {}): Promise<OnboardingList> {
  const qs = new URLSearchParams();
  if (opts.stage) qs.set('stage', opts.stage);
  if (opts.q) qs.set('q', opts.q);
  qs.set('limit', String(opts.limit ?? 25));
  qs.set('offset', String(opts.offset ?? 0));
  return request<OnboardingList>(`${base()}?${qs.toString()}`);
}

export function getOnboarding(userId: string): Promise<OnboardingDetail> {
  return request<OnboardingDetail>(`${base()}/${encodeURIComponent(userId)}`);
}

export function decideOnboarding(userId: string, input: OnboardingDecisionInput): Promise<OnboardingDetail> {
  return request<OnboardingDetail>(`${base()}/${encodeURIComponent(userId)}/decision`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
