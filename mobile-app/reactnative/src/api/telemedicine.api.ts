// ── Telemedicine — API client ────────────────────────────────────────────────
// Phase A: every function resolves demo data so screens render without a live
// API. `DEMO_*` exports are also used as `placeholderData` in useQuery.
//
// Phase C: a live branch has been added to every exported function, following
// the doctor.client.ts / fx.api.ts convention. Flip to live by setting
// `EXPO_PUBLIC_TELEMEDICINE_USE_MOCK=false`.

import { Colors } from '@/constants/colors';
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  Specialty,
  Doctor,
  Slot,
  Appointment,
  Prescription,
  VisitSummary,
  Review,
  BookAppointmentInput,
  BookAppointmentResult,
  ConsultStatus,
} from '@/types/telemedicine';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// ─── Feature flag: flip to false once the Go backend is ready ─────────────────
// Mock by default; flip with EXPO_PUBLIC_TELEMEDICINE_USE_MOCK=false to hit the
// live /api/v1/telemedicine/* routes (see backend/internal/app/finance_routes.go).
const TELEMEDICINE_USE_MOCK = (process.env.EXPO_PUBLIC_TELEMEDICINE_USE_MOCK ?? 'true') !== 'false';

// All live telemedicine endpoints live under this prefix on the API base URL.
const BASE = '/api/v1/telemedicine';

// Response envelope: the backend may wrap payloads as `{ data: <payload> }` or
// return the payload directly. Both are accepted (`res.data.data ?? res.data`).
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | undefined;
  return ((body && typeof body === 'object' && 'data' in body ? body.data : body) ?? body) as T;
}

// ─── Demo data ───────────────────────────────────────────────────────────────

export const DEMO_SPECIALTIES: Specialty[] = [
  { id: 'gp',        name: 'General',       icon: 'Stethoscope', accent: Colors.primary,   bg: Colors.iconBgPurple, doctorCount: 24 },
  { id: 'cardio',    name: 'Cardiology',    icon: 'HeartPulse',  accent: '#EF4444',        bg: 'rgba(239,68,68,0.08)', doctorCount: 8 },
  { id: 'derma',     name: 'Dermatology',   icon: 'Sparkles',    accent: '#F59E0B',        bg: 'rgba(245,158,11,0.10)', doctorCount: 11 },
  { id: 'pediatric', name: 'Pediatrics',    icon: 'Baby',        accent: Colors.secondary, bg: Colors.iconBgBlue,   doctorCount: 14 },
  { id: 'mental',    name: 'Mental Health', icon: 'Brain',       accent: '#A855F7',        bg: 'rgba(168,85,247,0.08)', doctorCount: 9 },
  { id: 'ob-gyn',    name: 'OB-GYN',        icon: 'Flower2',     accent: '#EC4899',        bg: 'rgba(236,72,153,0.08)', doctorCount: 7 },
  { id: 'dental',    name: 'Dental',        icon: 'Smile',       accent: Colors.teal,      bg: Colors.iconBgTeal,   doctorCount: 6 },
  { id: 'nutrition', name: 'Nutrition',     icon: 'Apple',       accent: '#16A34A',        bg: 'rgba(22,163,74,0.08)', doctorCount: 5 },
];

export const DEMO_DOCTORS: Doctor[] = [
  {
    id: 'doc-1', name: 'Dr. Amaka Obi', title: 'MBBS, FWACP', specialtyId: 'gp',
    specialties: ['General Practice', 'Family Medicine'],
    bio: 'Family physician with over a decade of experience in primary care, chronic disease management and preventive health.',
    initials: 'AO', avatarColor: Colors.primary, feeKobo: 350000, rating: 4.9, reviewCount: 312,
    yearsExperience: 12, languages: ['English', 'Igbo'], isOnline: true, nextAvailable: 'Today, 4:30 PM',
  },
  {
    id: 'doc-2', name: 'Dr. Tunde Bello', title: 'MBBS, FMCP (Cardiology)', specialtyId: 'cardio',
    specialties: ['Cardiology', 'Internal Medicine'],
    bio: 'Consultant cardiologist focused on hypertension, heart failure and preventive cardiology for adults.',
    initials: 'TB', avatarColor: '#EF4444', feeKobo: 750000, rating: 4.8, reviewCount: 198,
    yearsExperience: 15, languages: ['English', 'Yoruba'], isOnline: true, nextAvailable: 'Today, 6:00 PM',
  },
  {
    id: 'doc-3', name: 'Dr. Ngozi Eze', title: 'MBBS, MSc Dermatology', specialtyId: 'derma',
    specialties: ['Dermatology', 'Cosmetic Care'],
    bio: 'Dermatologist treating acne, eczema, hyperpigmentation and a wide range of skin conditions.',
    initials: 'NE', avatarColor: '#F59E0B', feeKobo: 500000, rating: 4.7, reviewCount: 144,
    yearsExperience: 9, languages: ['English'], isOnline: false, nextAvailable: 'Tomorrow, 10:00 AM',
  },
  {
    id: 'doc-4', name: 'Dr. Sarah Johnson', title: 'MBBS, FWACP (Paediatrics)', specialtyId: 'pediatric',
    specialties: ['Pediatrics', 'Neonatology'],
    bio: 'Paediatrician passionate about child wellness, immunisation and developmental care.',
    initials: 'SJ', avatarColor: Colors.secondary, feeKobo: 450000, rating: 5.0, reviewCount: 276,
    yearsExperience: 11, languages: ['English', 'French'], isOnline: true, nextAvailable: 'Today, 5:15 PM',
  },
  {
    id: 'doc-5', name: 'Dr. Ibrahim Musa', title: 'MBBS, MD Psychiatry', specialtyId: 'mental',
    specialties: ['Mental Health', 'Psychiatry'],
    bio: 'Psychiatrist offering compassionate, confidential support for anxiety, depression and stress.',
    initials: 'IM', avatarColor: '#A855F7', feeKobo: 600000, rating: 4.9, reviewCount: 167,
    yearsExperience: 13, languages: ['English', 'Hausa'], isOnline: true, nextAvailable: 'Tomorrow, 9:00 AM',
  },
  {
    id: 'doc-6', name: 'Dr. Funke Adeyemi', title: 'BDS, FWACS', specialtyId: 'dental',
    specialties: ['Dental', 'Oral Health'],
    bio: 'Dental surgeon providing teleconsultations for oral pain, hygiene advice and treatment planning.',
    initials: 'FA', avatarColor: Colors.teal, feeKobo: 400000, rating: 4.6, reviewCount: 89,
    yearsExperience: 8, languages: ['English', 'Yoruba'], isOnline: false, nextAvailable: 'Tomorrow, 2:00 PM',
  },
];

function buildSlots(): Slot[] {
  const slots: Slot[] = [];
  const times = ['09:00 AM', '10:30 AM', '12:00 PM', '01:30 PM', '03:00 PM', '04:30 PM', '06:00 PM'];
  for (let d = 0; d < 5; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const iso = date.toISOString().slice(0, 10);
    times.forEach((time, i) => {
      slots.push({ id: `${iso}-${i}`, date: iso, time, available: (d + i) % 3 !== 0 });
    });
  }
  return slots;
}

export const DEMO_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-1', ref: 'TM-9F2A41',
    doctor: { id: 'doc-1', name: 'Dr. Amaka Obi', title: 'MBBS, FWACP', initials: 'AO', avatarColor: Colors.primary, specialties: ['General Practice'] },
    consultType: 'video', status: 'confirmed', slotDate: new Date().toISOString().slice(0, 10), slotTime: '04:30 PM',
    feeKobo: 350000, createdAt: new Date().toISOString(), reason: 'Persistent headache and fatigue',
  },
  {
    id: 'apt-2', ref: 'TM-7C1B88',
    doctor: { id: 'doc-4', name: 'Dr. Sarah Johnson', title: 'MBBS, FWACP', initials: 'SJ', avatarColor: Colors.secondary, specialties: ['Pediatrics'] },
    consultType: 'audio', status: 'upcoming', slotDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), slotTime: '10:00 AM',
    feeKobo: 450000, createdAt: new Date().toISOString(), reason: 'Child immunisation review',
  },
  {
    id: 'apt-3', ref: 'TM-3D0F12',
    doctor: { id: 'doc-3', name: 'Dr. Ngozi Eze', title: 'MBBS, MSc', initials: 'NE', avatarColor: '#F59E0B', specialties: ['Dermatology'] },
    consultType: 'chat', status: 'completed', slotDate: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), slotTime: '02:00 PM',
    feeKobo: 500000, createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), reason: 'Recurring skin rash',
    doctorNote: 'Likely contact dermatitis. Prescribed topical cream; avoid known irritants and review in two weeks.',
  },
];

const DEMO_PRESCRIPTION: Prescription = {
  id: 'rx-1', appointmentId: 'apt-3', doctorName: 'Dr. Ngozi Eze', issuedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  items: [
    { name: 'Hydrocortisone 1% cream', dosage: 'Apply thin layer', frequency: 'Twice daily', duration: '14 days' },
    { name: 'Cetirizine', dosage: '10mg', frequency: 'Once at night', duration: '7 days' },
  ],
};

const DEMO_SUMMARY: VisitSummary = {
  id: 'vs-1', appointmentId: 'apt-3',
  diagnosis: 'Contact dermatitis (mild)',
  notes: 'Patient reports recurring rash on forearms after handling cleaning agents. No systemic symptoms. Skin examined via video; localized erythema noted.',
  followUp: 'Review in 2 weeks. Return sooner if spreading, blistering or fever develops.',
};

// ─── Read endpoints ──────────────────────────────────────────────────────────

export async function getSpecialties(): Promise<Specialty[]> {
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_SPECIALTIES); }
  return unwrap<Specialty[]>(await api.get(`${BASE}/specialties`));
}

export async function getDoctors(specialtyId?: string): Promise<Doctor[]> {
  if (TELEMEDICINE_USE_MOCK) {
    const list = specialtyId ? DEMO_DOCTORS.filter((d) => d.specialtyId === specialtyId) : DEMO_DOCTORS;
    return wait(list);
  }
  return unwrap<Doctor[]>(await api.get(`${BASE}/doctors`, { params: specialtyId ? { specialtyId } : undefined }));
}

export async function getDoctor(id: string): Promise<Doctor | undefined> {
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_DOCTORS.find((d) => d.id === id)); }
  return unwrap<Doctor | undefined>(await api.get(`${BASE}/doctors/${id}`));
}

export async function getDoctorAvailability(doctorId: string): Promise<Slot[]> {
  if (TELEMEDICINE_USE_MOCK) { return wait(buildSlots()); }
  return unwrap<Slot[]>(await api.get(`${BASE}/doctors/${doctorId}/availability`));
}

export async function getDoctorReviews(doctorId: string): Promise<Review[]> {
  // Not previously present in the mock file; mock branch returns an empty list
  // so callers can adopt this without needing new demo fixtures.
  if (TELEMEDICINE_USE_MOCK) { return wait([]); }
  return unwrap<Review[]>(await api.get(`${BASE}/doctors/${doctorId}/reviews`));
}

export async function getAppointments(): Promise<Appointment[]> {
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_APPOINTMENTS); }
  return unwrap<Appointment[]>(await api.get(`${BASE}/appointments`));
}

export async function getAppointment(id: string): Promise<Appointment | undefined> {
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_APPOINTMENTS.find((a) => a.id === id)); }
  return unwrap<Appointment | undefined>(await api.get(`${BASE}/appointments/${id}`));
}

export async function getPrescription(appointmentId: string): Promise<Prescription> {
  // Closest live route: POST /appointments/:id/prescription is how a doctor
  // issues one; there's no dedicated GET in the route list, so we read it back
  // via the visit summary endpoint's appointment id and fall back to the same
  // path pattern (backend may accept GET on this path for the patient view).
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_PRESCRIPTION); }
  return unwrap<Prescription>(await api.get(`${BASE}/appointments/${appointmentId}/prescription`));
}

export async function getVisitSummary(appointmentId: string): Promise<VisitSummary> {
  if (TELEMEDICINE_USE_MOCK) { return wait(DEMO_SUMMARY); }
  return unwrap<VisitSummary>(await api.get(`${BASE}/appointments/${appointmentId}/summary`));
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  if (TELEMEDICINE_USE_MOCK) {
    const ref = `TM-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    const result: BookAppointmentResult = { appointmentId: `apt-${Date.now()}`, ref, status: 'upcoming' as ConsultStatus };
    return wait(result, 600);
  }
  // MONEY PATH: requires Idempotency-Key.
  const idempotencyKey = input.idempotencyKey || generateIdempotencyKey();
  return unwrap<BookAppointmentResult>(
    await api.post(`${BASE}/appointments`, input, { headers: { 'Idempotency-Key': idempotencyKey } }),
  );
}

export async function confirmAppointment(appointmentId: string): Promise<{ status: ConsultStatus }> {
  if (TELEMEDICINE_USE_MOCK) { return wait({ status: 'confirmed' as ConsultStatus }, 400); }
  return unwrap<{ status: ConsultStatus }>(await api.post(`${BASE}/appointments/${appointmentId}/confirm`, {}));
}

export async function rescheduleAppointment(
  appointmentId: string,
  input: { slotDate: string; slotTime: string },
): Promise<Appointment> {
  if (TELEMEDICINE_USE_MOCK) {
    const found = DEMO_APPOINTMENTS.find((a) => a.id === appointmentId);
    const updated: Appointment = { ...(found as Appointment), slotDate: input.slotDate, slotTime: input.slotTime };
    return wait(updated, 500);
  }
  return unwrap<Appointment>(await api.post(`${BASE}/appointments/${appointmentId}/reschedule`, input));
}

export async function completeAppointment(appointmentId: string): Promise<{ status: ConsultStatus }> {
  if (TELEMEDICINE_USE_MOCK) { return wait({ status: 'completed' as ConsultStatus }, 400); }
  return unwrap<{ status: ConsultStatus }>(await api.post(`${BASE}/appointments/${appointmentId}/complete`, {}));
}

export async function cancelAppointment(appointmentId: string): Promise<{ status: ConsultStatus }> {
  if (TELEMEDICINE_USE_MOCK) { return wait({ status: 'cancelled' as ConsultStatus }, 500); }
  return unwrap<{ status: ConsultStatus }>(await api.post(`${BASE}/appointments/${appointmentId}/cancel`, {}));
}

export async function submitReview(input: { appointmentId: string; rating: number; comment: string }): Promise<Review> {
  if (TELEMEDICINE_USE_MOCK) {
    const review: Review = { id: `rev-${Date.now()}`, appointmentId: input.appointmentId, rating: input.rating, comment: input.comment, createdAt: new Date().toISOString() };
    return wait(review, 500);
  }
  return unwrap<Review>(await api.post(`${BASE}/appointments/${input.appointmentId}/review`, input));
}

export async function issuePrescription(
  appointmentId: string,
  input: { items: Prescription['items']; notes?: string },
): Promise<Prescription> {
  // Doctor-facing action (POST /appointments/:id/prescription).
  if (TELEMEDICINE_USE_MOCK) {
    const rx: Prescription = { id: `rx-${Date.now()}`, appointmentId, doctorName: DEMO_PRESCRIPTION.doctorName, issuedAt: new Date().toISOString(), items: input.items };
    return wait(rx, 500);
  }
  return unwrap<Prescription>(await api.post(`${BASE}/appointments/${appointmentId}/prescription`, input));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;
}
