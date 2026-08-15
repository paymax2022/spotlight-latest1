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

/**
 * Server-computed price breakdown for booking a consultation. The backend is the
 * single authority for the platform fee rate — this app renders these numbers and
 * MUST NOT compute the rate itself, or the amount displayed and the amount
 * escrowed can drift apart again (ADR-040).
 */
export interface BookingQuote {
  consultFeeKobo:  number;
  platformFeeBp:   number;   // basis points, e.g. 500 = 5%
  platformFeeKobo: number;
  totalKobo:       number;   // consultFeeKobo + platformFeeKobo
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
  /**
   * Price breakdown for booking this doctor, computed by the server. Optional
   * because an older backend will not send it — checkout screens must fail closed
   * when it is missing rather than pricing the booking locally.
   */
  booking?:        BookingQuote;
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
  /** The doctor's consultation fee alone — NOT what the patient paid. */
  feeKobo:     number;
  /** Platform booking fee charged on top. 0 for bookings made before ADR-040. */
  platformFeeKobo?: number;
  /** What the patient actually paid (fee + platform fee), and what a cancellation refunds. */
  totalKobo?:  number;
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
  /** ISO datetime for the chosen slot — the backend's required `scheduled_at`. */
  scheduledAt?:   string;
  consultType:    ConsultType;
  reason:         string;
  feeKobo:        number;
  /**
   * The total this app quoted the patient, taken straight from the server's own
   * `booking` quote. The server rejects the booking if it disagrees with its own
   * computation, which bounds the card rail — that rail charges this amount at the
   * PSP before the server escrows anything (ADR-040).
   */
  expectedTotalKobo?: number;
  idempotencyKey: string;
}

export interface BookAppointmentResult {
  appointmentId: string;
  ref:           string;
  status:        ConsultStatus;
}
