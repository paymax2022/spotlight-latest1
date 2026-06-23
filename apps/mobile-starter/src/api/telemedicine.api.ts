import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Provider, Appointment } from '@/types/fintech';

// ─── Extended types for Paymax Health Premium Ecosystem ─────────────────────

export interface DoctorProfile {
  id: string;
  name: string;
  specialty: string;
  sub_specialty?: string;
  image_url: string;
  rating: number;
  review_count: number;
  patients_count: number;
  experience_years: number;
  success_rate: number;
  consultation_fee_kobo: number;
  is_available: boolean;
  is_hmo_verified: boolean;
  distance_km?: number;
  about: string;
  education: { institution: string; degree: string; year: number }[];
  available_dates: string[];
  available_slots: Record<string, string[]>;
}

export interface ConsultationSpecialty {
  id: string;
  name: string;
  description: string;
  icon: string;
  doctor_count: number;
  is_featured: boolean;
}

export interface PharmacyProduct {
  id: string;
  name: string;
  category: string;
  price_kobo: number;
  unit: string;
  is_bestseller: boolean;
  is_essential: boolean;
  image_url: string;
  in_stock: boolean;
}

export interface HealthAppointment {
  id: string;
  provider_id?: string;
  doctor_name: string;
  doctor_specialty: string;
  doctor_image_url: string;
  date: string;
  time: string;
  consultation_type: 'video' | 'in_person';
  join_url?: string;
  starts_at: string;
  notes?: string;
  fee_kobo?: number;
  status: 'upcoming' | 'in_progress' | 'completed' | 'cancelled';
}

export interface DoctorDashboardStats {
  weekly_revenue_kobo: number;
  revenue_growth_pct: number;
  patients_seen: number;
  rating: number;
  is_online: boolean;
}

export interface PendingRequest {
  id: string;
  patient_name: string;
  request_type: string;
  created_at: string;
}

export interface ScheduledAppointment {
  id: string;
  patient_name: string;
  patient_image_url: string;
  time: string;
  type: 'video' | 'in_person';
  reason: string;
  status: 'pending' | 'confirmed' | 'in_progress';
}

export interface SOAPNote {
  appointment_id: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  prescriptions: { drug: string; dosage: string; duration: string }[];
}

export interface CartItem {
  product_id: string;
  quantity: number;
  price_kobo: number;
  name: string;
}

// ─── Patient-facing API ───────────────────────────────────────────────────────

export async function listProviders(params?: {
  type?: 'doctor' | 'pharmacy' | 'lab';
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Provider[]> {
  const response = await api.get('/api/v1/telemedicine/providers', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.providers ?? [];
}

export async function getProvider(id: string): Promise<Provider> {
  const response = await api.get(`/api/v1/telemedicine/providers/${id}`);
  return response.data?.data ?? response.data;
}

export async function listSpecialties(): Promise<ConsultationSpecialty[]> {
  const response = await api.get('/api/v1/telemedicine/specialties');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.specialties ?? [];
}

export async function listDoctors(params?: {
  specialty_id?: string;
  search?: string;
  available_now?: boolean;
  top_rated?: boolean;
  min_experience?: number;
  limit?: number;
  offset?: number;
}): Promise<DoctorProfile[]> {
  const response = await api.get('/api/v1/telemedicine/doctors', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.doctors ?? [];
}

export async function getDoctorProfile(id: string): Promise<DoctorProfile> {
  const response = await api.get(`/api/v1/telemedicine/doctors/${id}`);
  return response.data?.data ?? response.data;
}

export async function bookAppointment(payload: {
  doctor_id: string;
  date: string;
  time: string;
  type: 'video' | 'in_person';
  notes?: string;
}): Promise<HealthAppointment> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/telemedicine/appointments', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function listMyAppointments(
  filter?: 'upcoming' | 'past'
): Promise<HealthAppointment[]> {
  const params = filter ? { filter } : undefined;
  const response = await api.get('/api/v1/telemedicine/appointments', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.appointments ?? [];
}

export async function getAppointment(id: string): Promise<HealthAppointment> {
  const response = await api.get(`/api/v1/telemedicine/appointments/${id}`);
  return response.data?.data ?? response.data;
}

// ─── Pharmacy API ─────────────────────────────────────────────────────────────

export async function listPharmacyProducts(params?: {
  category?: string;
  search?: string;
}): Promise<PharmacyProduct[]> {
  const response = await api.get('/api/v1/pharmacy/products', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.products ?? [];
}

export async function addToCart(payload: {
  product_id: string;
  quantity: number;
}): Promise<CartItem> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/pharmacy/cart', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function getCart(): Promise<CartItem[]> {
  const response = await api.get('/api/v1/pharmacy/cart');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : [];
}

export async function updateCartItem(productId: string, quantity: number): Promise<CartItem> {
  const response = await api.patch(`/api/v1/pharmacy/cart/${productId}`, { quantity });
  return response.data?.data ?? response.data;
}

export async function removeFromCart(productId: string): Promise<void> {
  await api.delete(`/api/v1/pharmacy/cart/${productId}`);
}

export async function clearCart(): Promise<void> {
  await api.delete('/api/v1/pharmacy/cart');
}

// ─── Doctor-facing API ───────────────────────────────────────────────────────

export async function getDoctorDashboard(): Promise<{
  stats: DoctorDashboardStats;
  pending_requests: PendingRequest[];
  todays_appointments: ScheduledAppointment[];
}> {
  const response = await api.get('/api/v1/telemedicine/doctor/dashboard');
  return response.data?.data ?? response.data;
}

export async function toggleDoctorAvailability(is_online: boolean): Promise<void> {
  await api.patch('/api/v1/telemedicine/doctor/availability', { is_online });
}

export async function submitSOAPNote(payload: SOAPNote): Promise<void> {
  const idempotencyKey = generateIdempotencyKey();
  await api.post('/api/v1/telemedicine/doctor/notes', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function uploadMedicalLicence(payload: {
  document_type: string;
  base64: string;
  filename: string;
}): Promise<{ upload_id: string }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/telemedicine/doctor/licence', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function registerDoctor(payload: {
  full_name: string;
  email: string;
  phone: string;
  specialty: string;
  years_experience: number;
  mdcn_number: string;
}): Promise<{ doctor_id: string }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/telemedicine/doctor/register', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
