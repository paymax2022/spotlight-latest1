import { api } from '@/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Estate {
  id: string;
  name: string;
  address?: string;
  admin_id: string;
  created_at: string;
}

export interface VisitorPass {
  id: string;
  estate_id: string;
  issued_by: string;
  visitor_name: string;
  purpose?: string;
  qr_code: string;
  valid_from: string;
  valid_until: string;
  used_at?: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  created_at: string;
}

export interface Election {
  id: string;
  estate_id: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'open' | 'closed' | 'tallied';
  created_by: string;
  created_at: string;
  candidates?: Candidate[];
}

export interface Candidate {
  id: string;
  election_id: string;
  name: string;
  bio?: string;
  votes?: number;
}

export interface ElectionResult {
  candidate_id: string;
  name: string;
  votes: number;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function createEstate(payload: {
  name: string;
  address?: string;
}): Promise<Estate> {
  const response = await api.post('/api/finance/estate', payload);
  return response.data?.data ?? response.data;
}

export async function listMyPasses(estateId: string): Promise<VisitorPass[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/passes`);
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.passes ?? [];
}

export async function issueVisitorPass(
  estateId: string,
  payload: {
    visitor_name: string;
    purpose?: string;
    valid_from: string;
    valid_until: string;
  }
): Promise<VisitorPass> {
  const response = await api.post(`/api/finance/estate/${estateId}/passes`, payload);
  return response.data?.data ?? response.data;
}

export async function scanPass(
  estateId: string,
  qrCode: string
): Promise<VisitorPass> {
  const response = await api.post(`/api/finance/estate/${estateId}/passes/scan`, {
    qr_code: qrCode,
  });
  return response.data?.data ?? response.data;
}

export async function listElections(estateId: string): Promise<Election[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/elections`);
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.elections ?? [];
}

export async function castVote(
  estateId: string,
  electionId: string,
  candidateId: string
): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/elections/${electionId}/vote`, {
    candidate_id: candidateId,
  });
}

export async function getElectionResults(
  estateId: string,
  electionId: string
): Promise<ElectionResult[]> {
  const response = await api.get(
    `/api/finance/estate/${estateId}/elections/${electionId}/results`
  );
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.results ?? [];
}

// ─── Block 24: Onboarding & property selection ───────────────────────────────

export interface InviteCode {
  id: string;
  estate_id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
}

export interface JoinRequest {
  id: string;
  estate_id: string;
  user_id: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface EstateProperty {
  id: string;
  estate_id: string;
  unit_label: string;
  property_type: 'apartment' | 'house' | 'commercial' | 'land' | 'other';
  floor?: string;
  block?: string;
  occupancy_status: 'vacant' | 'occupied' | 'reserved';
  landlord_id?: string;
  tenant_id?: string;
  created_at: string;
}

export interface OwnershipClaim {
  id: string;
  property_id: string;
  user_id: string;
  ownership_doc_url: string;
  status: 'pending' | 'approved' | 'rejected';
  verified_by?: string;
  verified_at?: string;
  reject_reason?: string;
  created_at: string;
}

export interface TenancyRequest {
  id: string;
  property_id: string;
  tenant_id: string;
  landlord_id: string;
  lease_start: string;
  lease_end?: string;
  agreement_url?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_at?: string;
  created_at: string;
}

export async function listEstates(search?: string): Promise<Estate[]> {
  const response = await api.get('/api/finance/estate', { params: search ? { search } : undefined });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.estates ?? [];
}

export async function generateInviteCode(
  estateId: string,
  payload: { max_uses: number; expires_at: string }
): Promise<InviteCode> {
  const response = await api.post(`/api/finance/estate/${estateId}/invite-codes`, payload);
  return response.data?.data ?? response.data;
}

export async function joinWithInviteCode(code: string): Promise<void> {
  await api.post('/api/finance/estate/join/invite', { code });
}

export async function requestAccess(estateId: string, message?: string): Promise<JoinRequest> {
  const response = await api.post(`/api/finance/estate/${estateId}/access-request`, { message });
  return response.data?.data ?? response.data;
}

export async function getMyJoinRequest(estateId: string): Promise<JoinRequest> {
  const response = await api.get(`/api/finance/estate/${estateId}/access-request/me`);
  return response.data?.data ?? response.data;
}

export async function listJoinRequests(estateId: string, status?: string): Promise<JoinRequest[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/access-requests`, {
    params: status ? { status } : undefined,
  });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.requests ?? [];
}

export async function reviewJoinRequest(
  estateId: string,
  reqId: string,
  decision: 'approved' | 'rejected'
): Promise<JoinRequest> {
  const response = await api.post(`/api/finance/estate/${estateId}/access-requests/${reqId}/review`, { decision });
  return response.data?.data ?? response.data;
}

export async function listProperties(estateId: string): Promise<EstateProperty[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/properties`);
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.properties ?? [];
}

export async function addProperty(
  estateId: string,
  payload: { unit_label: string; property_type: string; floor?: string; block?: string }
): Promise<EstateProperty> {
  const response = await api.post(`/api/finance/estate/${estateId}/properties`, payload);
  return response.data?.data ?? response.data;
}

export async function claimOwnership(
  estateId: string,
  propertyId: string,
  ownershipDocUrl: string
): Promise<OwnershipClaim> {
  const response = await api.post(`/api/finance/estate/${estateId}/properties/${propertyId}/claim`, {
    ownership_doc_url: ownershipDocUrl,
  });
  return response.data?.data ?? response.data;
}

export async function createTenancyRequest(
  estateId: string,
  propertyId: string,
  payload: { landlord_id: string; lease_start: string; lease_end?: string; agreement_url?: string }
): Promise<TenancyRequest> {
  const response = await api.post(
    `/api/finance/estate/${estateId}/properties/${propertyId}/tenancy`,
    payload
  );
  return response.data?.data ?? response.data;
}

export async function reviewTenancyRequest(
  estateId: string,
  propertyId: string,
  tenancyId: string,
  decision: 'approved' | 'rejected'
): Promise<TenancyRequest> {
  const response = await api.post(
    `/api/finance/estate/${estateId}/properties/${propertyId}/tenancy/${tenancyId}/review`,
    { decision }
  );
  return response.data?.data ?? response.data;
}

// ── Block 25: Resident profiles ───────────────────────────────────────────────

export interface ContactInfo {
  name?: string;
  phone?: string;
  relationship?: string;
  address?: string;
}

export interface ResidentProfile {
  id: string;
  resident_id: string;
  bio?: string;
  profile_photo_url?: string;
  phone?: string;
  alt_phone?: string;
  emergency_contact?: ContactInfo;
  next_of_kin?: ContactInfo;
  occupancy_type: 'resident' | 'tenant' | 'homeowner' | 'landlord';
  lease_start?: string;
  lease_end?: string;
  agreement_url?: string;
  ownership_doc_url?: string;
  visibility: 'public' | 'members' | 'admin_only';
  created_at: string;
  updated_at: string;
}

export interface HouseholdMember {
  id: string;
  resident_id: string;
  full_name: string;
  relationship: string;
  dob?: string;
  id_type?: string;
  id_number?: string;
  photo_url?: string;
  created_at: string;
}

export interface DomesticStaff {
  id: string;
  resident_id: string;
  full_name: string;
  role: string;
  photo_url?: string;
  id_type?: string;
  id_number?: string;
  phone?: string;
  status: 'active' | 'suspended' | 'terminated';
  created_at: string;
}

export interface ResidentVehicle {
  id: string;
  resident_id: string;
  plate: string;
  make?: string;
  model?: string;
  color?: string;
  doc_url?: string;
  verified: boolean;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
}

export async function getProfile(estateId: string): Promise<ResidentProfile> {
  const response = await api.get(`/api/finance/estate/${estateId}/profile`);
  return response.data;
}

export async function upsertProfile(
  estateId: string,
  payload: Partial<Omit<ResidentProfile, 'id' | 'resident_id' | 'created_at' | 'updated_at'>>
): Promise<ResidentProfile> {
  const response = await api.put(`/api/finance/estate/${estateId}/profile`, payload);
  return response.data;
}

export async function listHouseholdMembers(estateId: string): Promise<HouseholdMember[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/profile/household`);
  return response.data?.data ?? [];
}

export async function addHouseholdMember(
  estateId: string,
  payload: { full_name: string; relationship: string; dob?: string; id_type?: string; id_number?: string; photo_url?: string }
): Promise<HouseholdMember> {
  const response = await api.post(`/api/finance/estate/${estateId}/profile/household`, payload);
  return response.data;
}

export async function deleteHouseholdMember(estateId: string, memberId: string): Promise<void> {
  await api.delete(`/api/finance/estate/${estateId}/profile/household/${memberId}`);
}

export async function listDomesticStaff(estateId: string): Promise<DomesticStaff[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/profile/staff`);
  return response.data?.data ?? [];
}

export async function addDomesticStaff(
  estateId: string,
  payload: { full_name: string; role: string; photo_url?: string; id_type?: string; id_number?: string; phone?: string }
): Promise<DomesticStaff> {
  const response = await api.post(`/api/finance/estate/${estateId}/profile/staff`, payload);
  return response.data;
}

export async function updateStaffStatus(
  estateId: string,
  staffId: string,
  status: 'active' | 'suspended' | 'terminated'
): Promise<void> {
  await api.patch(`/api/finance/estate/${estateId}/profile/staff/${staffId}/status`, { status });
}

export async function listVehicles(estateId: string): Promise<ResidentVehicle[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/profile/vehicles`);
  return response.data?.data ?? [];
}

export async function addVehicle(
  estateId: string,
  payload: { plate: string; make?: string; model?: string; color?: string; doc_url?: string }
): Promise<ResidentVehicle> {
  const response = await api.post(`/api/finance/estate/${estateId}/profile/vehicles`, payload);
  return response.data;
}

export async function verifyVehicle(estateId: string, vehicleId: string): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/profile/vehicles/${vehicleId}/verify`, {});
}

export interface ResidentCard {
  resident_id: string;
  estate_id: string;
  estate_name: string;
  full_name: string;
  unit: string;
  role: string;
  occupancy_type: string;
  profile_photo_url?: string;
  qr_value: string; // "<estate_id>:<resident_id>" encoded in QR
  issued_at: string;
}

export async function getResidentCard(estateId: string): Promise<ResidentCard> {
  const res = await api.get(`/api/finance/estate/${estateId}/profile/id-card`);
  return res.data;
}

// ── Block 26: Dashboard ───────────────────────────────────────────────────────

export interface EstateDashboard {
  estate_id: string;
  estate_name: string;
  resident_unit?: string;
  active_visitor_codes: number;
  open_elections: number;
  open_repairs: number;
  pending_payment?: { amount_kobo: number; due_date?: string; label?: string };
  upcoming_meetings: Array<{ id: string; title: string; starts_at: string; location?: string }>;
  announcements: Array<{ id: string; title: string; body?: string; created_at: string }>;
  security_alerts: Array<{ id: string; description: string; severity: string; created_at: string }>;
  property_status?: string;
  vehicle_count: number;
  household_count: number;
}

export async function getEstateDashboard(estateId: string): Promise<EstateDashboard> {
  const response = await api.get(`/api/finance/estate/${estateId}/dashboard`);
  return response.data;
}

// ── Block 27: Extended visitor access codes ───────────────────────────────────

export type CodeType =
  | 'one_time' | 'recurring' | 'multi_day' | 'delivery'
  | 'ridehailing' | 'staff' | 'contractor' | 'event_guest' | 'family';

export interface AccessCode {
  id: string;
  estate_id: string;
  issued_by: string;
  visitor_name: string;
  visitor_phone?: string;
  vehicle_plate?: string;
  purpose?: string;
  code_type: CodeType;
  numeric_code: string;
  qr_code: string;
  valid_from: string;
  valid_until: string;
  recurrence?: string;
  used_count: number;
  max_uses: number;
  status: 'active' | 'used' | 'expired' | 'revoked';
  blacklisted: boolean;
  created_at: string;
}

export interface Checkin {
  id: string;
  code_id: string;
  guard_id?: string;
  gate_id?: string;
  event: 'arrived' | 'checked_out';
  captured_at: string;
  photo_url?: string;
}

export async function createAccessCode(
  estateId: string,
  payload: {
    visitor_name: string;
    visitor_phone?: string;
    vehicle_plate?: string;
    purpose?: string;
    code_type: CodeType;
    valid_from: string;
    valid_until: string;
    max_uses?: number;
    recurrence?: string;
  }
): Promise<AccessCode> {
  const response = await api.post(`/api/finance/estate/${estateId}/access-codes`, payload);
  return response.data;
}

export async function listAccessCodes(estateId: string, status?: string): Promise<AccessCode[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/access-codes`, { params: status ? { status } : {} });
  return response.data?.data ?? [];
}

export async function getAccessCode(estateId: string, codeId: string): Promise<AccessCode> {
  const response = await api.get(`/api/finance/estate/${estateId}/access-codes/${codeId}`);
  return response.data;
}

export async function revokeCode(estateId: string, codeId: string): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/access-codes/${codeId}/revoke`, {});
}

export async function extendCode(estateId: string, codeId: string, validUntil: string): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/access-codes/${codeId}/extend`, { valid_until: validUntil });
}

export async function blacklistVisitor(estateId: string, codeId: string): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/access-codes/${codeId}/blacklist`, {});
}

export async function getCheckinHistory(estateId: string, codeId: string): Promise<Checkin[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/access-codes/${codeId}/history`);
  return response.data?.data ?? [];
}

// ── Block 28: Guard app ───────────────────────────────────────────────────────

export interface Gate {
  id: string;
  estate_id: string;
  name: string;
  gate_type: 'pedestrian' | 'vehicle' | 'service';
  active: boolean;
  created_at: string;
}

export interface GuardShift {
  id: string;
  guard_id: string;
  gate_id: string;
  estate_id: string;
  started_at: string;
  ended_at?: string;
  handover_notes?: string;
  relieved_by?: string;
  created_at: string;
}

export interface IncidentReport {
  id: string;
  estate_id: string;
  guard_id: string;
  gate_id?: string;
  incident_type: string;
  description: string;
  evidence_url?: string;
  escalated: boolean;
  created_at: string;
}

export interface CheckinPayload {
  code: AccessCode;
  resident_unit?: string;
  blacklisted: boolean;
  allowed: boolean;
  checkin_id?: string;
}

export async function listGates(estateId: string): Promise<Gate[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/gates`);
  return response.data?.data ?? [];
}

export async function getExpectedVisitors(estateId: string): Promise<AccessCode[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/guard/expected-visitors`);
  return response.data?.data ?? [];
}

export async function lookupCode(estateId: string, params: { numeric_code?: string; qr_code?: string }): Promise<CheckinPayload> {
  const response = await api.get(`/api/finance/estate/${estateId}/guard/lookup`, { params });
  return response.data;
}

export async function guardCheckin(
  estateId: string,
  payload: { numeric_code?: string; qr_code?: string; gate_id?: string; vehicle_plate?: string; photo_url?: string }
): Promise<CheckinPayload> {
  const response = await api.post(`/api/finance/estate/${estateId}/guard/checkin`, payload);
  return response.data;
}

export async function guardCheckout(estateId: string, codeId: string, gateId?: string): Promise<void> {
  await api.post(`/api/finance/estate/${estateId}/guard/checkout`, { code_id: codeId, gate_id: gateId });
}

export async function submitIncident(
  estateId: string,
  payload: { gate_id?: string; incident_type: string; description: string; evidence_url?: string; escalated?: boolean }
): Promise<IncidentReport> {
  const response = await api.post(`/api/finance/estate/${estateId}/guard/incident`, payload);
  return response.data;
}

export async function listIncidents(estateId: string): Promise<IncidentReport[]> {
  const response = await api.get(`/api/finance/estate/${estateId}/guard/incidents`);
  return response.data?.data ?? [];
}

export async function handoverShift(
  estateId: string,
  payload: { gate_id: string; handover_notes?: string; relieved_by?: string }
): Promise<GuardShift> {
  const response = await api.post(`/api/finance/estate/${estateId}/guard/shift-handover`, payload);
  return response.data;
}

export async function syncOfflineLogs(
  estateId: string,
  logs: Array<{ client_id: string; event_type: string; payload: any; captured_at: string }>
): Promise<{ synced: number }> {
  const response = await api.post(`/api/finance/estate/${estateId}/guard/sync`, { logs });
  return response.data;
}
