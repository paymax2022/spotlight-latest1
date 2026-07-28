// ── Doctor (Telemedicine, provider-side) — Batch 1 API client ────────────────
// Batch 1 = spec sections C, D, E, F. Phase A style: every function resolves
// demo data so screens render without a live API. `DEMO_*` exports double as
// `placeholderData` in useQuery. ADDITIVE to `@/api/doctor.api`,
// `@/api/doctor.phase2.api`, `@/api/doctor.profile.api` and
// `@/api/doctor.phase3.api` — earlier fns/exports are untouched.
//
// Sections: C vet profile & verification, D dashboard aggregate + alerts,
// E availability & schedule management, F appointment & consultation queue.
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/dashboard'); return res.data.data;
// uploads → presigned R2 PUT; mutations pass the Idempotency-Key header below.

import { Colors } from '@/constants/colors';
import {
  DEMO_APPOINTMENTS,
  DEMO_EARNINGS,
  DEMO_AVAILABILITY,
} from '@/api/doctor.api';
import type {
  VetProfileDraft,
  VetVerificationSubmission,
  VetLicenceInfo,
  ProfileDocumentSlot,
  UploadedFile,
  DoctorDashboardData,
  DoctorPresence,
  PlatformAnnouncement,
  ScheduleSettings,
  BlockedDate,
  VacationPeriod,
  ReminderSettings,
  RecurringRule,
  OverbookingCheck,
  ConsultationQueueItem,
  AppointmentRequest,
  ConsultCountdown,
  SaveVetProfileDraftInput,
  SaveVetProfileDraftResult,
  SubmitVetVerificationInput,
  SubmitVetVerificationResult,
  RenewVetLicenceInput,
  RenewVetLicenceResult,
  PublishVetProfileInput,
  PublishVetProfileResult,
  SetPresenceInput,
  SetPresenceResult,
  DismissAnnouncementInput,
  DismissAnnouncementResult,
  BlockDateInput,
  BlockDateResult,
  SetVacationInput,
  SetVacationResult,
  ToggleEmergencyInput,
  ToggleEmergencyResult,
  SaveReminderSettingsInput,
  SaveReminderSettingsResult,
  SaveRecurringRuleInput,
  SaveRecurringRuleResult,
  SetTimezoneInput,
  SetTimezoneResult,
  AcceptAppointmentInput,
  AcceptAppointmentResult,
  RejectAppointmentInput,
  RejectAppointmentResult,
  RequestRescheduleInput,
  RequestRescheduleResult,
  RescheduleAppointmentInput,
  RescheduleAppointmentResult,
  CancelAppointmentInput,
  CancelAppointmentResult,
  StartConsultationInput,
  StartConsultationResult,
  EndConsultationInput,
  EndConsultationResult,
  MarkNoShowInput,
  MarkNoShowResult,
} from '@/types/doctor.batch1';

// Re-export the shared money formatter so Batch 1 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION C — VETERINARY DOCTOR PROFILE & VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: vet document slots ───────────────────────────────────────────

export const DEMO_VET_DOCUMENT_SLOTS: ProfileDocumentSlot[] = [
  { type: 'medical_license',  label: 'Veterinary Licence (VCN)', required: true,
    file: { id: 'vf-lic', uri: 'file:///demo/vet-licence.pdf', fileName: 'vet-licence.pdf', mimeType: 'application/pdf', uploadedAt: iso(1) } },
  { type: 'degree_certificate', label: 'Degree Certificate (DVM)', required: true },
  { type: 'government_id',     label: 'Government ID (NIN)',      required: true,
    file: { id: 'vf-nin', uri: 'file:///demo/nin.jpg', fileName: 'nin.jpg', mimeType: 'image/jpeg', uploadedAt: iso(1) } },
  { type: 'passport_photo',    label: 'Passport Photograph',     required: true },
  { type: 'certificate',       label: 'Additional Certificate',  required: false },
];

// ─── Demo data: the in-progress vet profile draft ────────────────────────────

export const DEMO_VET_PROFILE_DRAFT: VetProfileDraft = {
  id: 'vet-draft-1', doctorId: 'doc-1',
  personalInfo: {
    firstName: 'Amaka', lastName: 'Obi', title: 'Dr.', gender: 'female',
    dateOfBirth: '1986-04-12', email: 'amaka.obi@spotlight.ng', phone: '+234 803 123 4567',
    state: 'Lagos', city: 'Lekki', address: '12 Adeola Odeku St, Victoria Island',
  },
  bio: 'Small-animal veterinarian with 9 years in companion-animal medicine, surgery and preventive care.',
  specialtyId: 'vet-small-animal',
  subSpecialtyIds: ['Companion Animal Medicine', 'Veterinary Surgery'],
  speciesTreated: ['dog', 'cat', 'bird', 'rabbit', 'rodent'],
  yearsExperience: 9,
  licence: {
    licenceNumber: 'VCN/R/0184', issuingBody: 'VCN',
    issuedAt: isoDate(-700), expiresAt: isoDate(40), status: 'expiring_soon',
    licenceFile: { id: 'vf-lic', uri: 'file:///demo/vet-licence.pdf', fileName: 'vet-licence.pdf', mimeType: 'application/pdf', uploadedAt: iso(1) },
  },
  documents: DEMO_VET_DOCUMENT_SLOTS,
  certificates: [
    { id: 'vf-cert1', uri: 'file:///demo/vet-surgery.pdf', fileName: 'small-animal-surgery.pdf', mimeType: 'application/pdf', uploadedAt: iso(3) },
  ],
  affiliations: [
    { id: 'vaff-1', name: 'Pawscare Veterinary Clinic', role: 'Lead Veterinarian', state: 'Lagos', city: 'Lekki', isPrimary: true },
  ],
  workExperience: [
    { id: 'vwork-1', organisation: 'Pawscare Veterinary Clinic', role: 'Lead Veterinarian', location: 'Lekki, Lagos', startYear: 2019, isCurrent: true, description: 'Companion-animal medicine, soft-tissue surgery, preventive care.' },
    { id: 'vwork-2', organisation: 'University of Ibadan Vet Teaching Hospital', role: 'Resident Veterinarian', location: 'Ibadan, NG', startYear: 2016, endYear: 2019, isCurrent: false },
  ],
  pricing: {
    videoFeeKobo: 300000, audioFeeKobo: 250000, chatFeeKobo: 200000,
    currency: 'NGN', acceptsInstant: true,
  },
  completedSteps: [
    'personal_info', 'specialty', 'species', 'licence_number', 'licence_upload',
    'certificates', 'affiliations', 'experience', 'pricing', 'availability',
  ],
  status: 'unsubmitted',
  updatedAt: iso(0),
  isPublished: false,
};

// ─── Demo data: vet verification submission (pending state) ──────────────────

export const DEMO_VET_VERIFICATION: VetVerificationSubmission = {
  id: 'vver-1', draftId: 'vet-draft-1', status: 'pending',
  submittedAt: iso(2),
  documents: DEMO_VET_DOCUMENT_SLOTS,
  notes: 'Awaiting review against the VCN register.',
};

// ─── Read endpoints (Section C) ──────────────────────────────────────────────

export async function getVetProfileDraft(draftId?: string): Promise<VetProfileDraft> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_PROFILE_DRAFT);
  return doctorGet<VetProfileDraft>('/vet/profile/draft', { draftId });
}

export async function getVetDocumentSlots(): Promise<ProfileDocumentSlot[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_DOCUMENT_SLOTS);
  return doctorGet<ProfileDocumentSlot[]>('/vet/profile/documents');
}

export async function getVetVerification(submissionId?: string): Promise<VetVerificationSubmission> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_VERIFICATION);
  return doctorGet<VetVerificationSubmission>('/vet/verification', { submissionId });
}

// ─── Mutations (Section C) ───────────────────────────────────────────────────

export async function saveVetProfileDraft(input: SaveVetProfileDraftInput): Promise<SaveVetProfileDraftResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draft;
    return wait({ draftId: DEMO_VET_PROFILE_DRAFT.id, status: 'unsubmitted', updatedAt: new Date().toISOString() }, 500);
  }
  return doctorPut<SaveVetProfileDraftResult>('/vet/profile/draft', input, input.idempotencyKey);
}

export async function submitVetVerification(input: SubmitVetVerificationInput): Promise<SubmitVetVerificationResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draftId;
    return wait({ submissionId: `vver-${Date.now()}`, status: 'pending' }, 700);
  }
  return doctorPost<SubmitVetVerificationResult>('/vet/verification', input, input.idempotencyKey);
}

export async function renewVetLicence(input: RenewVetLicenceInput): Promise<RenewVetLicenceResult> {
  if (DOCTOR_USE_MOCK) {
    void input.newExpiresAt;
    return wait({ renewalId: `vlr-${Date.now()}`, status: 'pending' }, 700);
  }
  return doctorPost<RenewVetLicenceResult>('/vet/licence/renew', input, input.idempotencyKey);
}

export async function publishVetProfile(input: PublishVetProfileInput): Promise<PublishVetProfileResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draftId;
    return wait({ doctorId: 'doc-1', isPublished: true, publishedAt: new Date().toISOString() }, 600);
  }
  return doctorPost<PublishVetProfileResult>('/vet/profile/publish', input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION D — DOCTOR DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: platform announcement ────────────────────────────────────────

export const DEMO_ANNOUNCEMENT: PlatformAnnouncement = {
  id: 'ann-1', tone: 'info', title: 'New: AI prescription safety checker',
  body: 'You can now run a one-tap drug-interaction check before issuing a prescription.',
  publishedAt: iso(1), dismissible: true, ctaLabel: 'Learn more', ctaRoute: 'announcements',
};

// ─── Demo data: the dashboard aggregate ──────────────────────────────────────

export const DEMO_DASHBOARD: DoctorDashboardData = {
  presence: 'online',
  acceptsInstant: true,
  counts: {
    todaysAppointments:   4,
    upcomingAppointments: 2,
    pendingRequests:      3,
    waitingRoom:          2,
    followUpRequests:     2,
    unreadMessages:       3,
    newLabResults:        1,
    pendingPrescriptions: 2,
    refillRequests:       1,
    hmoApprovals:         1,
  },
  todaysAppointments: DEMO_APPOINTMENTS.slice(0, 3),
  pendingRequests: DEMO_APPOINTMENTS.filter((a) => a.status === 'upcoming'),
  activeConsultation: {
    appointmentId: 'apt-3', ref: 'TM-3D0F12', patientName: 'Chidi Okeke', initials: 'CO',
    avatarColor: '#F59E0B', consultType: 'chat', startedAt: new Date(Date.now() - 6 * 60000).toISOString(), elapsedSecs: 372,
  },
  waitingRoom: [
    { appointmentId: 'apt-2', patientName: 'Fatima Bello', initials: 'FB', avatarColor: '#EC4899', consultType: 'audio', waitMins: 4, isHmo: true },
    { appointmentId: 'apt-1', patientName: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, consultType: 'video', waitMins: 1, isHmo: false },
  ],
  messages: [
    { threadId: 'thr-1', patientName: 'Chidi Okeke', initials: 'CO', avatarColor: '#F59E0B', snippet: 'Thank you doctor, I will start the new dose tomorrow.', at: iso(0), unread: true },
    { threadId: 'thr-2', patientName: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, snippet: 'I have uploaded the photo of the rash.', at: iso(0), unread: true },
  ],
  alerts: [
    { id: 'al-1', kind: 'urgent_case',         severity: 'critical', title: 'Urgent case waiting', body: 'Fatima Bello flagged as urgent — not eating, lethargic.', count: 1, createdAt: iso(0), cta: { label: 'Open queue', route: 'queue' } },
    { id: 'al-2', kind: 'new_lab_result',      severity: 'info',     title: 'New lab result', body: 'Results for LAB-8C1B22 (Ngozi Adeyemi) are ready to review.', count: 1, createdAt: iso(0), cta: { label: 'Review', route: 'labResults' } },
    { id: 'al-3', kind: 'hmo_approval',        severity: 'warning',  title: 'HMO approval pending', body: '1 HMO pre-authorisation is awaiting your confirmation.', count: 1, createdAt: iso(0), cta: { label: 'Review', route: 'hmo' } },
    { id: 'al-4', kind: 'refill_request',      severity: 'info',     title: 'Refill request', body: 'Chidi Okeke requested a refill of Lisinopril 10mg.', count: 1, createdAt: iso(0), cta: { label: 'Review', route: 'refills' } },
    { id: 'al-5', kind: 'pending_prescription', severity: 'info',    title: 'Pending prescriptions', body: '2 prescriptions are saved as drafts and not yet issued.', count: 2, createdAt: iso(0), cta: { label: 'Open', route: 'prescriptions' } },
    { id: 'al-6', kind: 'follow_up',           severity: 'info',     title: 'Follow-up requests', body: '2 patients requested a follow-up consultation.', count: 2, createdAt: iso(0), cta: { label: 'Review', route: 'followUps' } },
    { id: 'al-7', kind: 'licence_expiry',      severity: 'warning',  title: 'Licence expiring soon', body: 'Your MDCN licence expires in 45 days. Upload the renewed licence.', createdAt: iso(0), cta: { label: 'Renew now', route: 'licenceRenew' } },
    { id: 'al-8', kind: 'compliance',          severity: 'warning',  title: 'Compliance action needed', body: 'A required data-protection policy is awaiting your acknowledgement.', createdAt: iso(0), cta: { label: 'Acknowledge', route: 'compliance' } },
    { id: 'al-9', kind: 'profile_completion',  severity: 'info',     title: 'Complete your profile', body: 'Your profile is 85% complete. Add your bank account to receive payouts.', createdAt: iso(0), cta: { label: 'Finish setup', route: 'profileSetup' } },
  ],
  announcement: DEMO_ANNOUNCEMENT,
  earnings: DEMO_EARNINGS,
  satisfactionPct: 96,
};

// ─── Read endpoints (Section D) ──────────────────────────────────────────────

export async function getDashboard(): Promise<DoctorDashboardData> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DASHBOARD);
  return doctorGet<DoctorDashboardData>('/dashboard');
}

export async function getAnnouncement(): Promise<PlatformAnnouncement | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ANNOUNCEMENT);
  return doctorGet<PlatformAnnouncement | undefined>('/announcements/latest');
}

// ─── Mutations (Section D) ───────────────────────────────────────────────────

export async function setPresence(input: SetPresenceInput): Promise<SetPresenceResult> {
  if (DOCTOR_USE_MOCK) return wait({ presence: input.presence }, 400);
  return doctorPut<SetPresenceResult>('/presence', input, input.idempotencyKey);
}

export async function dismissAnnouncement(input: DismissAnnouncementInput): Promise<DismissAnnouncementResult> {
  if (DOCTOR_USE_MOCK) return wait({ announcementId: input.announcementId, dismissed: true }, 400);
  return doctorPost<DismissAnnouncementResult>(`/announcements/${input.announcementId}/dismiss`, input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION E — AVAILABILITY & SCHEDULE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: blocked dates, vacation, reminders, recurring rules ──────────

export const DEMO_BLOCKED_DATES: BlockedDate[] = [
  { id: 'bd-1', date: isoDate(3),  reason: 'Public holiday', allDay: true },
  { id: 'bd-2', date: isoDate(10), reason: 'Conference (afternoon)', allDay: false, startTime: '13:00', endTime: '17:00' },
];

export const DEMO_VACATION: VacationPeriod = {
  id: 'vac-1', startDate: isoDate(20), endDate: isoDate(27), note: 'Annual leave — back on the 28th.', active: false,
};

export const DEMO_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true, offsetsMins: [60, 15], channelPush: true, channelEmail: true, channelSms: false,
};

export const DEMO_RECURRING_RULES: RecurringRule[] = [
  { id: 'rr-1', frequency: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], startTime: '09:00', endTime: '17:00', startsOn: isoDate(-30), active: true },
  { id: 'rr-2', frequency: 'biweekly', days: ['sat'], startTime: '10:00', endTime: '13:00', startsOn: isoDate(-14), endsOn: isoDate(90), active: false },
];

// ─── Demo data: the extended schedule settings aggregate ─────────────────────

export const DEMO_SCHEDULE_SETTINGS: ScheduleSettings = {
  schedule: DEMO_AVAILABILITY,
  appointmentOnly: false,
  emergencyAvailable: true,
  timezone: 'Africa/Lagos',
  blockedDates: DEMO_BLOCKED_DATES,
  vacation: DEMO_VACATION,
  reminders: DEMO_REMINDER_SETTINGS,
  recurringRules: DEMO_RECURRING_RULES,
};

// ─── Read endpoints (Section E) ──────────────────────────────────────────────

export async function getScheduleSettings(): Promise<ScheduleSettings> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SCHEDULE_SETTINGS);
  return doctorGet<ScheduleSettings>('/schedule');
}

export async function getBlockedDates(): Promise<BlockedDate[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_BLOCKED_DATES);
  return doctorGet<BlockedDate[]>('/schedule/blocked-dates');
}

// Overbooking-check helper. Computes whether adding `requested` slots on `date`
// exceeds capacity. Pure (no latency) so the UI can call it inline as a warning.
export function checkOverbooking(
  date: string,
  capacity: number,
  booked: number,
  requested: number,
): OverbookingCheck {
  const total = booked + requested;
  const overBy = Math.max(0, total - capacity);
  const safe = overBy === 0;
  return {
    date, capacity, booked, requested, safe, overBy,
    message: safe
      ? `${total} of ${capacity} slots booked for this day.`
      : `Overbooked by ${overBy} — ${total} slots exceed the ${capacity}-slot capacity for this day.`,
  };
}

// ─── Mutations (Section E) ───────────────────────────────────────────────────

export async function blockDate(input: BlockDateInput): Promise<BlockDateResult> {
  if (DOCTOR_USE_MOCK) {
    const blocked: BlockedDate = {
      id: `bd-${Date.now()}`, date: input.date, reason: input.reason,
      allDay: input.allDay, startTime: input.startTime, endTime: input.endTime,
    };
    return wait({ blocked }, 500);
  }
  return doctorPost<BlockDateResult>('/schedule/blocked-dates', input, input.idempotencyKey);
}

export async function setVacation(input: SetVacationInput): Promise<SetVacationResult> {
  if (DOCTOR_USE_MOCK) {
    const vacation: VacationPeriod = {
      id: `vac-${Date.now()}`, startDate: input.startDate, endDate: input.endDate,
      note: input.note, active: input.active,
    };
    return wait({ vacation }, 500);
  }
  return doctorPut<SetVacationResult>('/schedule/vacation', input, input.idempotencyKey);
}

export async function toggleEmergency(input: ToggleEmergencyInput): Promise<ToggleEmergencyResult> {
  if (DOCTOR_USE_MOCK) return wait({ emergencyAvailable: input.enabled }, 400);
  return doctorPut<ToggleEmergencyResult>('/schedule/emergency', input, input.idempotencyKey);
}

export async function saveReminderSettings(input: SaveReminderSettingsInput): Promise<SaveReminderSettingsResult> {
  if (DOCTOR_USE_MOCK) return wait({ reminders: input.reminders }, 500);
  return doctorPut<SaveReminderSettingsResult>('/schedule/reminders', input, input.idempotencyKey);
}

export async function saveRecurringRule(input: SaveRecurringRuleInput): Promise<SaveRecurringRuleResult> {
  if (DOCTOR_USE_MOCK) {
    const rule: RecurringRule = { ...input.rule, id: input.rule.id ?? `rr-${Date.now()}` };
    return wait({ rule }, 500);
  }
  return doctorPut<SaveRecurringRuleResult>('/schedule/recurring', input, input.idempotencyKey);
}

export async function setTimezone(input: SetTimezoneInput): Promise<SetTimezoneResult> {
  if (DOCTOR_USE_MOCK) return wait({ timezone: input.timezone }, 400);
  return doctorPut<SetTimezoneResult>('/schedule/timezone', input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION F — APPOINTMENT & CONSULTATION QUEUE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: consultation queue (priority-ordered) ────────────────────────

export const DEMO_QUEUE: ConsultationQueueItem[] = [
  { appointmentId: 'apt-2', ref: 'TM-7C1B88', patientName: 'Fatima Bello',  initials: 'FB', avatarColor: '#EC4899',         consultType: 'audio', status: 'confirmed',   priority: 'emergency', billing: 'hmo',            isHmo: true,  waitMins: 4,  slotTime: '05:15 PM', feeKobo: 350000 },
  { appointmentId: 'apt-1', ref: 'TM-9F2A41', patientName: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary,  consultType: 'video', status: 'confirmed',   priority: 'normal',    billing: 'paid',           isHmo: false, waitMins: 1,  slotTime: '04:30 PM', feeKobo: 350000 },
  { appointmentId: 'apt-5', ref: 'TM-2B7D33', patientName: 'Ngozi Adeyemi',  initials: 'NA', avatarColor: Colors.teal,       consultType: 'video', status: 'upcoming',    priority: 'low',       billing: 'free_follow_up', isHmo: false, waitMins: 0,  slotTime: '06:00 PM', feeKobo: 0 },
];

// ─── Demo data: pending appointment requests (accept/reject) ─────────────────

export const DEMO_APPOINTMENT_REQUESTS: AppointmentRequest[] = [
  {
    id: 'areq-1',
    appointment: DEMO_APPOINTMENTS[1], // Fatima — HMO
    status: 'pending', requestedAt: iso(0), billing: 'hmo', priority: 'high',
    patientNote: 'Recurring abdominal pain, would prefer an audio call.',
  },
  {
    id: 'areq-2',
    appointment: DEMO_APPOINTMENTS[0], // Tunde — paid
    status: 'pending', requestedAt: iso(0), billing: 'paid', priority: 'normal',
    patientNote: 'Persistent headache and fatigue for a week.',
  },
];

// ─── Read endpoints (Section F) ──────────────────────────────────────────────

export async function getConsultationQueue(): Promise<ConsultationQueueItem[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_QUEUE);
  return doctorGet<ConsultationQueueItem[]>('/queue');
}

export async function getAppointmentRequests(): Promise<AppointmentRequest[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_APPOINTMENT_REQUESTS);
  return doctorGet<AppointmentRequest[]>('/appointment-requests');
}

export async function getAppointmentRequest(id: string): Promise<AppointmentRequest | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_APPOINTMENT_REQUESTS.find((r) => r.id === id));
  return doctorGet<AppointmentRequest | undefined>(`/appointment-requests/${id}`);
}

// Consultation countdown helper. Computes minutes until the slot and derives the
// starting-soon / overdue / doctor-late states from one timestamp. Pure (no
// latency) so the UI can re-run it on a tick. `graceMins` = late threshold.
export function computeConsultCountdown(
  appointmentId: string,
  slotAt: string,
  soonWindowMins = 10,
  graceMins = 5,
  now: number = Date.now(),
): ConsultCountdown {
  const slotMs = new Date(slotAt).getTime();
  const minsUntil = Math.round((slotMs - now) / 60000);
  const isOverdue = minsUntil < 0;
  const isStartingSoon = minsUntil >= 0 && minsUntil <= soonWindowMins;
  const isDoctorLate = minsUntil < -graceMins;
  let label: string;
  if (isOverdue) {
    label = `Overdue by ${Math.abs(minsUntil)} min`;
  } else if (minsUntil === 0) {
    label = 'Starting now';
  } else {
    label = `Starts in ${minsUntil} min`;
  }
  return { appointmentId, slotAt, minsUntil, isStartingSoon, isOverdue, isDoctorLate, label };
}

// ─── Mutations (Section F) ───────────────────────────────────────────────────
// accept / reject / reschedule-request operate on a pending request; start /
// end / cancel / no-show / reschedule operate on a confirmed appointment. The
// existing `updateAppointmentStatus` (Phase 1) still covers generic status
// transitions; these add the named, intent-specific variants.

export async function acceptAppointment(input: AcceptAppointmentInput): Promise<AcceptAppointmentResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: input.appointmentId, status: 'accepted' as const }, 500);
  return doctorPost<AcceptAppointmentResult>(`/appointments/${input.appointmentId}/accept`, input, input.idempotencyKey);
}

export async function rejectAppointment(input: RejectAppointmentInput): Promise<RejectAppointmentResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ appointmentId: input.appointmentId, status: 'rejected' as const }, 500);
  }
  return doctorPost<RejectAppointmentResult>(`/appointments/${input.appointmentId}/reject`, input, input.idempotencyKey);
}

export async function requestReschedule(input: RequestRescheduleInput): Promise<RequestRescheduleResult> {
  if (DOCTOR_USE_MOCK) {
    void input.proposedSlotDate;
    return wait({ appointmentId: input.appointmentId, status: 'reschedule_requested' as const }, 500);
  }
  return doctorPost<RequestRescheduleResult>(`/appointments/${input.appointmentId}/request-reschedule`, input, input.idempotencyKey);
}

export async function rescheduleAppointment(input: RescheduleAppointmentInput): Promise<RescheduleAppointmentResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: input.appointmentId, slotDate: input.newSlotDate, slotTime: input.newSlotTime }, 600);
  return doctorPost<RescheduleAppointmentResult>(`/appointments/${input.appointmentId}/reschedule`, input, input.idempotencyKey);
}

export async function cancelAppointment(input: CancelAppointmentInput): Promise<CancelAppointmentResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ appointmentId: input.appointmentId, status: 'cancelled' as const }, 500);
  }
  return doctorPost<CancelAppointmentResult>(`/appointments/${input.appointmentId}/cancel`, input, input.idempotencyKey);
}

export async function startConsultation(input: StartConsultationInput): Promise<StartConsultationResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: input.appointmentId, status: 'in_progress' as const, startedAt: new Date().toISOString() }, 500);
  return doctorPost<StartConsultationResult>(`/appointments/${input.appointmentId}/start`, input, input.idempotencyKey);
}

export async function endConsultation(input: EndConsultationInput): Promise<EndConsultationResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: input.appointmentId, status: 'completed' as const, endedAt: new Date().toISOString(), durationSecs: 1320 }, 500);
  return doctorPost<EndConsultationResult>(`/appointments/${input.appointmentId}/end`, input, input.idempotencyKey);
}

export async function markNoShow(input: MarkNoShowInput): Promise<MarkNoShowResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: input.appointmentId, status: 'cancelled' as const }, 500);
  return doctorPost<MarkNoShowResult>(`/appointments/${input.appointmentId}/no-show`, input, input.idempotencyKey);
}
