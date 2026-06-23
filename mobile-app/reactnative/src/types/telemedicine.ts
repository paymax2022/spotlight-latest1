// ── Telemedicine — Domain Types ──────────────────────────────────────────────
// Phase A (mobile UI/UX). Money amounts are integers in minor units (kobo).

export type ConsultType = 'video' | 'audio' | 'chat';

export type ConsultStatus =
  | 'upcoming'     // booked, not yet confirmed by doctor
  | 'confirmed'    // doctor confirmed, awaiting start
  | 'in_progress'  // consultation live
  | 'completed'    // consultation finished
  | 'cancelled';   // cancelled by patient or doctor

export interface Specialty {
  id:           string;
  name:         string;
  icon:         string;   // lucide icon name
  accent:       string;   // hex
  bg:           string;   // tinted background
  doctorCount:  number;
}

export interface Doctor {
  id:              string;
  name:            string;
  title:           string;            // e.g. "MBBS, FWACP"
  specialtyId:     string;
  specialties:     string[];          // display labels
  bio:             string;
  initials:        string;
  avatarColor:     string;            // hex used for avatar circle
  feeKobo:         number;            // consultation fee in kobo
  rating:          number;            // 0–5
  reviewCount:     number;
  yearsExperience: number;
  languages:       string[];
  isOnline:        boolean;
  nextAvailable:   string;            // human label e.g. "Today, 4:30 PM"
}

export interface Slot {
  id:        string;
  date:      string;   // ISO date (YYYY-MM-DD)
  time:      string;   // "09:00 AM"
  available: boolean;
}

export interface DoctorSummary {
  id:          string;
  name:        string;
  title:       string;
  initials:    string;
  avatarColor: string;
  specialties: string[];
}

export interface Appointment {
  id:          string;
  ref:         string;            // human reference, e.g. "TM-9F2A41"
  doctor:      DoctorSummary;
  consultType: ConsultType;
  status:      ConsultStatus;
  slotDate:    string;            // ISO date
  slotTime:    string;            // "09:00 AM"
  feeKobo:     number;
  createdAt:   string;            // ISO datetime
  reason?:     string;            // patient's described reason
  doctorNote?: string;            // post-consult note
}

export interface PrescriptionItem {
  name:      string;
  dosage:    string;   // "500mg"
  frequency: string;   // "Twice daily"
  duration:  string;   // "5 days"
}

export interface Prescription {
  id:            string;
  appointmentId: string;
  doctorName:    string;
  issuedAt:      string;          // ISO datetime
  items:         PrescriptionItem[];
}

export interface VisitSummary {
  id:            string;
  appointmentId: string;
  diagnosis:     string;
  notes:         string;
  followUp?:     string;          // follow-up advice
}

export interface Review {
  id:            string;
  appointmentId: string;
  rating:        number;          // 1–5
  comment:       string;
  createdAt:     string;
}

export interface BookAppointmentInput {
  doctorId:       string;
  slotId:         string;
  consultType:    ConsultType;
  reason:         string;
  feeKobo:        number;
  idempotencyKey: string;
}

export interface BookAppointmentResult {
  appointmentId: string;
  ref:           string;
  status:        ConsultStatus;
}
