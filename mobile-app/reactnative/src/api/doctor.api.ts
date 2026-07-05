// ── Doctor (Telemedicine, provider-side) — API client ────────────────────────
// Phase A: every function resolves demo data so screens render without a live
// API. `DEMO_*` exports are also used as `placeholderData` in useQuery.
//
// TODO(Phase C): replace each function body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/appointments'); return res.data.data;
// and pass the Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import type {
  DoctorProfile,
  VerificationSubmission,
  DoctorAppointment,
  PatientMedicalProfile,
  ChatThread,
  ChatMessage,
  CallSession,
  SoapNote,
  DoctorPrescription,
  LabOrder,
  LabResult,
  HmoEligibility,
  AvailabilitySchedule,
  EarningsSummary,
  DoctorNotification,
  SupportTicket,
  DoctorSettings,
  SubmitVerificationInput,
  SubmitVerificationResult,
  UpdateAvailabilityInput,
  SaveSoapNoteInput,
  CreatePrescriptionInput,
  CreatePrescriptionResult,
  CreateLabOrderInput,
  CreateLabOrderResult,
  SendChatMessageInput,
  UpdateAppointmentStatusInput,
  RequestPayoutInput,
  RequestPayoutResult,
  MarkLabResultReviewedInput,
  CreateSupportTicketInput,
  CreateSupportTicketResult,
  UpdateDoctorSettingsInput,
  ConsultStatus,
  LabOrderStatus,
} from '@/types/doctor';

// Re-export the shared money formatter so doctor screens can import it from here.
export { formatKobo } from '@/api/telemedicine.api';
import {
  DOCTOR_USE_MOCK,
  doctorGet,
  doctorPost,
  doctorPut,
} from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// ─── Demo data ───────────────────────────────────────────────────────────────

export const DEMO_DOCTOR_PROFILE: DoctorProfile = {
  id: 'doc-1', name: 'Dr. Amaka Obi', title: 'MBBS, FWACP', specialtyId: 'gp',
  specialties: ['General Practice', 'Family Medicine'],
  subSpecialties: ['Chronic Disease Management', 'Preventive Health'],
  bio: 'Family physician with over a decade of experience in primary care, chronic disease management and preventive health.',
  initials: 'AO', avatarColor: Colors.primary, email: 'amaka.obi@spotlight.ng', phone: '+234 803 123 4567',
  mdcnNumber: 'MDCN/R/45821', feeKobo: 350000, rating: 4.9, reviewCount: 312,
  yearsExperience: 12, languages: ['English', 'Igbo'], isOnline: true, verification: 'approved',
  hospital: 'Lagoon Medical Centre', state: 'Lagos',
};

export const DEMO_VERIFICATION: VerificationSubmission = {
  id: 'ver-1', status: 'approved',
  submittedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  reviewedAt: new Date(Date.now() - 27 * 86400000).toISOString(),
  documents: [
    { type: 'mdcn_certificate',  label: 'MDCN Certificate',   fileName: 'mdcn-cert.pdf',  uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
    { type: 'medical_license',   label: 'Medical License',    fileName: 'license.pdf',    uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
    { type: 'degree_certificate', label: 'Degree Certificate', fileName: 'mbbs.pdf',       uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
    { type: 'government_id',     label: 'Government ID',       fileName: 'nin.jpg',        uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
    { type: 'passport_photo',    label: 'Passport Photo',     fileName: 'passport.jpg',   uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
  ],
  // PRIVACY: internal/reviewer-only — never surfaced on the doctor's screens.
  notes: 'Verification complete.',
};

const PATIENT_TUNDE = { id: 'pat-1', name: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, age: 34, gender: 'male' as const };
const PATIENT_FATIMA = { id: 'pat-2', name: 'Fatima Bello', initials: 'FB', avatarColor: '#EC4899', age: 28, gender: 'female' as const };
const PATIENT_CHIDI = { id: 'pat-3', name: 'Chidi Okeke', initials: 'CO', avatarColor: '#F59E0B', age: 45, gender: 'male' as const };
const PATIENT_NGOZI = { id: 'pat-4', name: 'Ngozi Adeyemi', initials: 'NA', avatarColor: Colors.teal, age: 52, gender: 'female' as const };

export const DEMO_APPOINTMENTS: DoctorAppointment[] = [
  {
    id: 'apt-1', ref: 'TM-9F2A41', patient: PATIENT_TUNDE,
    consultType: 'video', status: 'confirmed', slotDate: new Date().toISOString().slice(0, 10), slotTime: '04:30 PM',
    feeKobo: 350000, createdAt: new Date().toISOString(), reason: 'Persistent headache and fatigue', isHmo: false,
  },
  {
    id: 'apt-2', ref: 'TM-7C1B88', patient: PATIENT_FATIMA,
    consultType: 'audio', status: 'upcoming', slotDate: new Date().toISOString().slice(0, 10), slotTime: '05:15 PM',
    feeKobo: 350000, createdAt: new Date().toISOString(), reason: 'Recurring abdominal pain', isHmo: true, hmoProvider: 'Hygeia HMO',
  },
  {
    id: 'apt-3', ref: 'TM-3D0F12', patient: PATIENT_CHIDI,
    consultType: 'chat', status: 'in_progress', slotDate: new Date().toISOString().slice(0, 10), slotTime: '03:00 PM',
    feeKobo: 350000, createdAt: new Date().toISOString(), reason: 'Blood pressure review and medication refill', isHmo: false,
  },
  {
    id: 'apt-4', ref: 'TM-5A8E07', patient: PATIENT_NGOZI,
    consultType: 'video', status: 'completed', slotDate: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), slotTime: '10:00 AM',
    feeKobo: 350000, createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), reason: 'Follow-up on diabetes management', isHmo: true, hmoProvider: 'Avon HMO',
  },
];

export const DEMO_PATIENT_PROFILE: PatientMedicalProfile = {
  patient: PATIENT_TUNDE,
  bloodGroup: 'O+', genotype: 'AA',
  allergies: ['Penicillin', 'Peanuts'],
  chronicConditions: ['Hypertension'],
  currentMedications: ['Amlodipine 5mg', 'Lisinopril 10mg'],
  vitals: [
    { label: 'Blood Pressure', value: '138/88 mmHg' },
    { label: 'Heart Rate',     value: '76 bpm' },
    { label: 'Temperature',    value: '36.8 °C' },
    { label: 'Weight',         value: '82 kg' },
  ],
  history: [
    { id: 'h-1', date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10), summary: 'Routine BP check, medication adjusted', doctorName: 'Dr. Amaka Obi' },
    { id: 'h-2', date: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10), summary: 'Diagnosed with stage 1 hypertension', doctorName: 'Dr. Tunde Bello' },
  ],
};

export const DEMO_CHAT_THREADS: ChatThread[] = [
  {
    id: 'thr-1', appointmentId: 'apt-3', patient: PATIENT_CHIDI,
    lastMessage: 'Thank you doctor, I will start the new dose tomorrow.',
    lastMessageAt: new Date(Date.now() - 5 * 60000).toISOString(), unreadCount: 2, consultType: 'chat', status: 'in_progress',
  },
  {
    id: 'thr-2', appointmentId: 'apt-1', patient: PATIENT_TUNDE,
    lastMessage: 'I have uploaded the photo of the rash.',
    lastMessageAt: new Date(Date.now() - 2 * 3600000).toISOString(), unreadCount: 0, consultType: 'video', status: 'confirmed',
  },
];

export const DEMO_CHAT_MESSAGES: ChatMessage[] = [
  { id: 'msg-1', threadId: 'thr-1', author: 'patient', body: 'Good afternoon doctor, my BP reading this morning was 150/95.', createdAt: new Date(Date.now() - 30 * 60000).toISOString() },
  { id: 'msg-2', threadId: 'thr-1', author: 'doctor',  body: 'Good afternoon. Have you been taking the Amlodipine consistently?', createdAt: new Date(Date.now() - 28 * 60000).toISOString() },
  { id: 'msg-3', threadId: 'thr-1', author: 'patient', body: 'Yes, but I missed two days last week.', createdAt: new Date(Date.now() - 25 * 60000).toISOString() },
  { id: 'msg-4', threadId: 'thr-1', author: 'doctor',  body: 'Understood. Let us increase to 10mg daily and review in two weeks.', createdAt: new Date(Date.now() - 10 * 60000).toISOString() },
  { id: 'msg-5', threadId: 'thr-1', author: 'patient', body: 'Thank you doctor, I will start the new dose tomorrow.', createdAt: new Date(Date.now() - 5 * 60000).toISOString() },
];

const DEMO_CALL: CallSession = {
  id: 'call-1', appointmentId: 'apt-1', patient: PATIENT_TUNDE, mode: 'video', status: 'live',
  startedAt: new Date(Date.now() - 4 * 60000).toISOString(), durationSecs: 248,
};

const DEMO_SOAP_NOTE: SoapNote = {
  id: 'soap-1', appointmentId: 'apt-4', patientId: 'pat-4',
  subjective: 'Patient reports good adherence to medication. Occasional dizziness in the mornings. No chest pain or palpitations.',
  objective: 'BP 132/84 mmHg, HR 74 bpm. Random blood glucose 7.2 mmol/L. No peripheral oedema.',
  assessment: 'Type 2 diabetes mellitus, reasonably controlled. Hypertension stable.',
  plan: 'Continue Metformin 500mg BD. Reduce Amlodipine to 5mg. Repeat HbA1c in 3 months. Dietary counselling reinforced.',
  diagnosis: ['Type 2 Diabetes Mellitus', 'Essential Hypertension'],
  createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
};

const DEMO_PRESCRIPTIONS: DoctorPrescription[] = [
  {
    id: 'rx-1', ref: 'RX-4F2A41', appointmentId: 'apt-4', patient: PATIENT_NGOZI, doctorName: 'Dr. Amaka Obi',
    diagnosis: 'Type 2 Diabetes Mellitus', issuedAt: new Date(Date.now() - 2 * 86400000).toISOString(), status: 'issued',
    items: [
      { name: 'Metformin', dosage: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '30 days', notes: 'Take after meals' },
      { name: 'Amlodipine', dosage: '5mg', route: 'Oral', frequency: 'Once daily', duration: '30 days' },
    ],
  },
  {
    id: 'rx-2', ref: 'RX-7C1B88', appointmentId: 'apt-3', patient: PATIENT_CHIDI, doctorName: 'Dr. Amaka Obi',
    diagnosis: 'Essential Hypertension', issuedAt: new Date(Date.now() - 6 * 86400000).toISOString(), status: 'dispensed',
    items: [
      { name: 'Lisinopril', dosage: '10mg', route: 'Oral', frequency: 'Once daily', duration: '28 days' },
    ],
  },
];

const DEMO_LAB_ORDERS: LabOrder[] = [
  {
    id: 'lab-1', ref: 'LAB-8C1B22', appointmentId: 'apt-4', patient: PATIENT_NGOZI,
    tests: [
      { id: 'lt-hba1c', name: 'Glycated Haemoglobin', code: 'HbA1c', category: 'Chemistry' },
      { id: 'lt-lipid', name: 'Lipid Profile', code: 'LIPID', category: 'Chemistry' },
    ],
    clinicalNote: 'Diabetes monitoring. Fasting sample preferred for lipid profile.',
    status: 'resulted', orderedAt: new Date(Date.now() - 2 * 86400000).toISOString(), priority: 'routine',
  },
  {
    id: 'lab-2', ref: 'LAB-3D0F90', appointmentId: 'apt-1', patient: PATIENT_TUNDE,
    tests: [{ id: 'lt-fbc', name: 'Full Blood Count', code: 'FBC', category: 'Haematology' }],
    clinicalNote: 'Fatigue work-up.',
    status: 'ordered', orderedAt: new Date().toISOString(), priority: 'routine',
  },
];

const DEMO_LAB_RESULT: LabResult = {
  id: 'res-1', orderId: 'lab-1', ref: 'LAB-8C1B22', patient: PATIENT_NGOZI,
  values: [
    { testName: 'HbA1c',             value: '7.1', unit: '%',      refRange: '4.0–5.6',   flag: 'high' },
    { testName: 'Total Cholesterol', value: '4.8', unit: 'mmol/L', refRange: '< 5.2',     flag: 'normal' },
    { testName: 'LDL',               value: '3.4', unit: 'mmol/L', refRange: '< 3.0',     flag: 'high' },
    { testName: 'HDL',               value: '1.3', unit: 'mmol/L', refRange: '> 1.0',     flag: 'normal' },
  ],
  reportedAt: new Date(Date.now() - 86400000).toISOString(), labName: 'Synlab Nigeria', reviewed: false,
};

const DEMO_HMO_ELIGIBILITY: HmoEligibility = {
  appointmentId: 'apt-2', patient: PATIENT_FATIMA, status: 'eligible',
  coverage: {
    provider: 'Hygeia HMO', planName: 'Gold', memberId: 'HYG-2284910',
    validUntil: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
    coveredServices: ['Teleconsultation', 'Prescriptions', 'Basic Lab Tests'],
  },
  copayKobo: 50000, authCode: 'AUTH-91X4', checkedAt: new Date().toISOString(),
};

export const DEMO_AVAILABILITY: AvailabilitySchedule = {
  doctorId: 'doc-1',
  workingDays: [
    { day: 'mon', enabled: true,  startTime: '09:00', endTime: '17:00' },
    { day: 'tue', enabled: true,  startTime: '09:00', endTime: '17:00' },
    { day: 'wed', enabled: true,  startTime: '09:00', endTime: '17:00' },
    { day: 'thu', enabled: true,  startTime: '09:00', endTime: '17:00' },
    { day: 'fri', enabled: true,  startTime: '09:00', endTime: '15:00' },
    { day: 'sat', enabled: false, startTime: '10:00', endTime: '13:00' },
    { day: 'sun', enabled: false, startTime: '10:00', endTime: '13:00' },
  ],
  breaks: [
    { id: 'brk-1', day: 'mon', startTime: '13:00', endTime: '14:00', label: 'Lunch' },
    { id: 'brk-2', day: 'wed', startTime: '13:00', endTime: '14:00', label: 'Lunch' },
  ],
  consultDurationMins: 30, bufferMins: 5, acceptsInstant: true,
};

export const DEMO_EARNINGS: EarningsSummary = {
  availableKobo: 1240000, pendingKobo: 350000, lifetimeKobo: 48750000, thisMonthKobo: 4200000, consultsThisMonth: 12,
  payouts: [
    { id: 'po-1', ref: 'PO-2026-014', amountKobo: 2100000, status: 'paid', consultCount: 6, periodLabel: '16–31 May 2026', paidAt: new Date(Date.now() - 18 * 86400000).toISOString() },
    { id: 'po-2', ref: 'PO-2026-013', amountKobo: 1750000, status: 'paid', consultCount: 5, periodLabel: '01–15 May 2026', paidAt: new Date(Date.now() - 33 * 86400000).toISOString() },
    { id: 'po-3', ref: 'PO-2026-015', amountKobo: 1240000, status: 'pending', consultCount: 4, periodLabel: '01–15 Jun 2026' },
  ],
};

export const DEMO_NOTIFICATIONS: DoctorNotification[] = [
  { id: 'n-1', type: 'appointment',  title: 'New appointment', body: 'Tunde Akinwale booked a video consult for 4:30 PM today.', createdAt: new Date(Date.now() - 20 * 60000).toISOString(), read: false },
  { id: 'n-2', type: 'lab_result',   title: 'Lab result ready', body: 'Results for LAB-8C1B22 (Ngozi Adeyemi) are available for review.', createdAt: new Date(Date.now() - 86400000).toISOString(), read: false },
  { id: 'n-3', type: 'payout',       title: 'Payout processed', body: 'Your payout PO-2026-014 of ₦21,000 has been paid.', createdAt: new Date(Date.now() - 18 * 86400000).toISOString(), read: true },
  { id: 'n-4', type: 'message',      title: 'New message', body: 'Chidi Okeke sent you a message.', createdAt: new Date(Date.now() - 5 * 60000).toISOString(), read: false },
];

export const DEMO_SUPPORT_TICKETS: SupportTicket[] = [
  { id: 'tkt-1', ref: 'TKT-1042', subject: 'Payout delayed', category: 'Payments', status: 'in_progress', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(), lastReply: 'Our finance team is reviewing your payout.' },
  { id: 'tkt-2', ref: 'TKT-0987', subject: 'Video call dropped mid-consult', category: 'Technical', status: 'resolved', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 8 * 86400000).toISOString() },
];

export const DEMO_SETTINGS: DoctorSettings = {
  doctorId: 'doc-1',
  notifyAppointments: true, notifyMessages: true, notifyPayouts: true,
  pushEnabled: true, emailEnabled: true, smsEnabled: false,
  showOnlineStatus: true, autoAcceptInstant: false,
  payoutBankName: 'GTBank', payoutAccountMasked: '****4821', preferredCurrency: 'NGN',
};

// ─── Read endpoints ──────────────────────────────────────────────────────────

export async function getDoctorProfile(): Promise<DoctorProfile> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DOCTOR_PROFILE);
  return doctorGet<DoctorProfile>('/profile');
}

export async function getVerification(): Promise<VerificationSubmission> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VERIFICATION);
  return doctorGet<VerificationSubmission>('/verification');
}

export async function getAvailability(doctorId?: string): Promise<AvailabilitySchedule> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_AVAILABILITY);
  return doctorGet<AvailabilitySchedule>('/availability', { doctorId });
}

export async function getAppointments(status?: ConsultStatus): Promise<DoctorAppointment[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_APPOINTMENTS.filter((a) => a.status === status) : DEMO_APPOINTMENTS;
    return wait(list);
  }
  return doctorGet<DoctorAppointment[]>('/appointments', { status });
}

export async function getAppointment(id: string): Promise<DoctorAppointment | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_APPOINTMENTS.find((a) => a.id === id));
  return doctorGet<DoctorAppointment | undefined>(`/appointments/${id}`);
}

export async function getPatientProfile(patientId: string): Promise<PatientMedicalProfile> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PATIENT_PROFILE);
  return doctorGet<PatientMedicalProfile>(`/patients/${patientId}`);
}

export async function getChatThreads(): Promise<ChatThread[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CHAT_THREADS);
  return doctorGet<ChatThread[]>('/chat/threads');
}

export async function getChatMessages(threadId: string): Promise<ChatMessage[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CHAT_MESSAGES.filter((m) => m.threadId === threadId));
  return doctorGet<ChatMessage[]>(`/chat/${threadId}/messages`);
}

export async function getCallSession(appointmentId: string): Promise<CallSession> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CALL);
  return doctorGet<CallSession>(`/calls/${appointmentId}`);
}

export async function getSoapNote(appointmentId: string): Promise<SoapNote | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SOAP_NOTE);
  return doctorGet<SoapNote | undefined>(`/appointments/${appointmentId}/notes`);
}

export async function getPrescriptions(): Promise<DoctorPrescription[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PRESCRIPTIONS);
  return doctorGet<DoctorPrescription[]>('/prescriptions');
}

export async function getPrescription(id: string): Promise<DoctorPrescription | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PRESCRIPTIONS.find((p) => p.id === id));
  return doctorGet<DoctorPrescription | undefined>(`/prescriptions/${id}`);
}

export async function getLabOrders(): Promise<LabOrder[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LAB_ORDERS);
  return doctorGet<LabOrder[]>('/lab-orders');
}

export async function getLabResult(orderId: string): Promise<LabResult> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LAB_RESULT);
  return doctorGet<LabResult>(`/lab-orders/${orderId}/result`);
}

export async function getHmoEligibility(appointmentId: string): Promise<HmoEligibility> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HMO_ELIGIBILITY);
  return doctorGet<HmoEligibility>(`/appointments/${appointmentId}/hmo-eligibility`);
}

export async function getEarnings(): Promise<EarningsSummary> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_EARNINGS);
  return doctorGet<EarningsSummary>('/earnings');
}

export async function getNotifications(): Promise<DoctorNotification[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_NOTIFICATIONS);
  return doctorGet<DoctorNotification[]>('/notifications');
}

export async function getSupportTickets(): Promise<SupportTicket[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SUPPORT_TICKETS);
  return doctorGet<SupportTicket[]>('/support/tickets');
}

export async function getSettings(): Promise<DoctorSettings> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SETTINGS);
  return doctorGet<DoctorSettings>('/settings');
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function submitVerification(input: SubmitVerificationInput): Promise<SubmitVerificationResult> {
  if (DOCTOR_USE_MOCK) {
    void input;
    return wait({ submissionId: `ver-${Date.now()}`, status: 'pending' }, 600);
  }
  return doctorPost<SubmitVerificationResult>('/verification', input, input.idempotencyKey);
}

export async function updateAvailability(input: UpdateAvailabilityInput): Promise<AvailabilitySchedule> {
  if (DOCTOR_USE_MOCK) return wait(input.schedule, 500);
  return doctorPut<AvailabilitySchedule>('/availability', input, input.idempotencyKey);
}

export async function updateAppointmentStatus(input: UpdateAppointmentStatusInput): Promise<{ status: ConsultStatus }> {
  if (DOCTOR_USE_MOCK) return wait({ status: input.status }, 500);
  return doctorPost<{ status: ConsultStatus }>(`/appointments/${input.appointmentId}/status`, input, input.idempotencyKey);
}

export async function saveSoapNote(input: SaveSoapNoteInput): Promise<SoapNote> {
  if (DOCTOR_USE_MOCK) {
    const now = new Date().toISOString();
    const note: SoapNote = {
      id: `soap-${Date.now()}`, appointmentId: input.appointmentId, patientId: input.patientId,
      subjective: input.subjective, objective: input.objective, assessment: input.assessment, plan: input.plan,
      diagnosis: input.diagnosis, createdAt: now, updatedAt: now,
    };
    return wait(note, 500);
  }
  return doctorPost<SoapNote>(`/appointments/${input.appointmentId}/notes`, input, input.idempotencyKey);
}

export async function createPrescription(input: CreatePrescriptionInput): Promise<CreatePrescriptionResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `RX-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ prescriptionId: `rx-${Date.now()}`, ref, status: 'issued' as DoctorPrescription['status'] }, 600);
  }
  return doctorPost<CreatePrescriptionResult>('/prescriptions', input, input.idempotencyKey);
}

export async function createLabOrder(input: CreateLabOrderInput): Promise<CreateLabOrderResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `LAB-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ orderId: `lab-${Date.now()}`, ref, status: 'ordered' as LabOrderStatus }, 600);
  }
  return doctorPost<CreateLabOrderResult>('/lab-orders', input, input.idempotencyKey);
}

export async function markLabResultReviewed(input: MarkLabResultReviewedInput): Promise<{ reviewed: boolean }> {
  if (DOCTOR_USE_MOCK) {
    void input;
    return wait({ reviewed: true }, 500);
  }
  return doctorPost<{ reviewed: boolean }>(`/lab-results/${input.resultId}/review`, input, input.idempotencyKey);
}

export async function sendChatMessage(input: SendChatMessageInput): Promise<ChatMessage> {
  if (DOCTOR_USE_MOCK) {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`, threadId: input.threadId, author: 'doctor', body: input.body,
      createdAt: new Date().toISOString(), attachmentUrl: input.attachmentUrl, attachmentName: input.attachmentName,
    };
    return wait(message, 400);
  }
  return doctorPost<ChatMessage>(`/chat/${input.threadId}/messages`, input, input.idempotencyKey);
}

export async function requestPayout(input: RequestPayoutInput): Promise<RequestPayoutResult> {
  if (DOCTOR_USE_MOCK) {
    void input.amountKobo;
    const ref = `PO-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ payoutId: `po-${Date.now()}`, ref, status: 'processing' as RequestPayoutResult['status'] }, 600);
  }
  return doctorPost<RequestPayoutResult>('/payouts', input, input.idempotencyKey);
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<CreateSupportTicketResult> {
  if (DOCTOR_USE_MOCK) {
    void input;
    return wait({ ticketId: `tkt-${Date.now()}`, ref: `TKT-${Math.floor(1000 + Math.random() * 9000)}`, status: 'open' as SupportTicket['status'] }, 500);
  }
  return doctorPost<CreateSupportTicketResult>('/support/tickets', input, input.idempotencyKey);
}

export async function updateSettings(input: UpdateDoctorSettingsInput): Promise<DoctorSettings> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_SETTINGS, ...input.settings }, 500);
  return doctorPut<DoctorSettings>('/settings', input, input.idempotencyKey);
}
