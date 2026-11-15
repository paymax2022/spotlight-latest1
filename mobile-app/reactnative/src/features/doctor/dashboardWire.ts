// Pure wire→domain mapping for GET /doctor/dashboard. It imports no React Native
// of its own; the shared plane it delegates to does pull `constants/tokens` in
// transitively, which is already answered for by the runner's react-native stub
// (tests/unit/stubs/react-native.mjs — `Platform.select` and all), the same reason
// npm run test:doctor-mapping can load features/doctor/mapping.ts at all. Like
// features/doctor/batch6Wire.ts, this file stays render-free so node:test covers it.
//
// The endpoint answers the flat DashboardSummary the Go service composes — NOT the
// rich DoctorDashboardData the screens render — so the translation happens here
// instead of the `doctorGet<DoctorDashboardData>('/dashboard')` cast that used to
// sit in the api module. That cast is how the tiles ended up hard-coded: the wire
// genuinely had no `counts.todaysAppointments` to read.

import { mapAppointmentWire } from '@/features/doctor/mapping';
import type { DoctorAppointment } from '@/types/doctor';
import type { DoctorDashboardData } from '@/types/doctor.batch1';

/** The body GET /doctor/dashboard writes (DashboardResponse in contracts/doctor.openapi.yaml). */
export interface DashboardWire {
  appointmentCounts?: Record<string, number>;
  unreadNotifications?: number;
  walletBalanceKobo?: number;
  currency?: string;
  metrics?: DashboardMetricsWire;
  todaysAppointments?: DashboardQueueAppointmentWire[];
}

export interface DashboardMetricsWire {
  todaysCount?: number;
  upcomingCount?: number;
  satisfactionPct?: number | null;
  ratingCount?: number;
  revenue?: DashboardRevenueWire;
  timezone?: string;
  today?: string;
}

export interface DashboardRevenueWire {
  pendingKobo?: number;
  lifetimeKobo?: number;
  thisMonthKobo?: number;
  consultsThisMonth?: number;
}

export interface DashboardQueueAppointmentWire {
  id?: string;
  ref?: string;
  patient?: DashboardQueuePatientWire;
  consultType?: string;
  status?: string;
  slotDate?: string;
  slotTime?: string;
  feeKobo?: number;
  reason?: string;
  isHmo?: boolean;
  createdAt?: string;
}

export interface DashboardQueuePatientWire {
  id?: string;
  name?: string;
  age?: number;
  gender?: string;
}

/**
 * 'Nov 13' from a slot date. The contract says YYYY-MM-DD; a full timestamp is
 * tolerated (slice to the day) because `new Date('<iso-timestamp>T00:00:00')` is
 * Invalid Date, which is what the queue used to render.
 */
export function formatSlotDateLabel(slotDate: string): string {
  return new Date(`${slotDate.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A queue row IS an appointment row, so it is mapped by the function the
 * appointments list already uses: #1008's `mapAppointmentWire` owns the avatar
 * rule, the `booked` → `upcoming` map, the gender normalise and the id-derived
 * `ref`, and three of its own spec files pin them. Duplicating any of that here
 * would let one patient wear different initials on two screens.
 *
 * `consultType` is the single field the delegation has to hand back.
 * `mapConsultType` collapses anything outside video/audio/chat to 'video' — under
 * test as intended, over there — while spec D8 wants the wire value verbatim,
 * `in_person` included, so an in-person booking is never displayed as a video
 * call. ConsultType has no in_person member yet: the cast is local to this
 * boundary, AppointmentRow draws a fallback icon (Task 6), and follow-up F4
 * widens the union for good.
 */
export function mapQueueAppointment(wire: DashboardQueueAppointmentWire): DoctorAppointment {
  const row = mapAppointmentWire({ ...wire, id: wire.id ?? '' });
  return { ...row, consultType: wire.consultType as DoctorAppointment['consultType'] };
}

export function mapDashboardWire(wire: DashboardWire): DoctorDashboardData {
  const m = wire.metrics ?? {};
  const revenue = m.revenue ?? {};
  const statusCounts = wire.appointmentCounts ?? {};
  return {
    // Presence and instant-accepting have their own endpoints (GET /presence,
    // GET /availability); the dashboard payload has never carried them.
    presence: 'offline',
    acceptsInstant: false,
    counts: {
      todaysAppointments: m.todaysCount ?? 0,
      upcomingAppointments: m.upcomingCount ?? 0,
      pendingRequests: statusCounts.pending ?? 0,
      waitingRoom: 0,
      followUpRequests: 0,
      unreadMessages: wire.unreadNotifications ?? 0,
      newLabResults: 0,
      pendingPrescriptions: 0,
      refillRequests: 0,
      hmoApprovals: 0,
    },
    todaysAppointments: (wire.todaysAppointments ?? []).map(mapQueueAppointment),
    pendingRequests: [],
    waitingRoom: [],
    messages: [],
    alerts: [],
    earnings: {
      // The wallet (available to withdraw) and the consult projection are two
      // different planes; the tile labels them accordingly.
      availableKobo: wire.walletBalanceKobo ?? 0,
      pendingKobo: revenue.pendingKobo ?? 0,
      lifetimeKobo: revenue.lifetimeKobo ?? 0,
      thisMonthKobo: revenue.thisMonthKobo ?? 0,
      consultsThisMonth: revenue.consultsThisMonth ?? 0,
      payouts: [],
    },
    satisfactionPct: m.satisfactionPct ?? null,
  };
}
