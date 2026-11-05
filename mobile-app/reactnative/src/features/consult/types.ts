// Shared consult wire types. Mirrors backend/internal/health/consultengine:
// snake_case on the wire, the module screens keep that spelling so a mapped
// field cannot drift from the server's JSON.

export type ConsultVertical = 'telemedicine' | 'vet' | 'pharmacy' | 'lab';
export type ConsultMode = 'chat' | 'voice' | 'video';
export type ConsultState = 'scheduled' | 'live' | 'ended' | 'cancelled';

export type ExtensionStatus =
  | 'pending_approval'
  | 'approved_awaiting_payment'
  | 'paid'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface ConsultSession {
  id: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  patient_id: string;
  provider_user_id: string;
  source_ref: string;
  package_id?: string;
  duration_minutes: number;
  price_kobo: number;
  booked_start: string;
  ends_at: string;
  warn_at: string;
  warning_sent_at?: string;
  state: ConsultState;
  room_name: string;
  base_hold_id?: string;
  ended_at?: string;
  /** The engine's clock when this row was read. Anchors the client timer. */
  server_now: string;
  extendable: boolean;
  provider_owner_kind: 'doctor' | 'health_provider';
  provider_owner_id: string;
}

export interface ConsultRtc {
  provider: string;
  url: string;
  room: string;
}

export interface ConsultJoin {
  token: string;
  rtc: ConsultRtc;
  session: ConsultSession;
}

export interface ConsultExtension {
  id: string;
  session_id: string;
  requested_by: string;
  added_minutes: number;
  price_kobo: number;
  status: ExtensionStatus;
  approved_at?: string;
  payment_expires_at?: string;
  paid_at?: string;
  escrow_id?: string;
  decided_by?: string;
  decline_reason?: string;
  created_at: string;
}

export interface ConsultMessage {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * One price point as every picker renders it. Telemedicine's package quote is
 * snake_case and carries the platform fee in `booking.total_kobo`; the vet's
 * is camelCase and the package price is the whole charge. Both collapse here
 * so a screen never computes a fee of its own (ADR-044).
 */
export interface ConsultOffer {
  id: string;
  mode: ConsultMode;
  durationMinutes: number;
  priceKobo: number;
  totalKobo: number;
}

export const CONSULT_MODE_LABEL: Record<ConsultMode, string> = {
  video: 'Video',
  voice: 'Voice',
  chat: 'Chat',
};

/** The module UI says "audio" where the engine says "voice". */
export function normalizeConsultMode(raw: string): ConsultMode | null {
  const mode = raw.trim().toLowerCase();
  if (mode === 'video' || mode === 'voice' || mode === 'chat') return mode;
  if (mode === 'audio') return 'voice';
  return null;
}

export interface DoctorPackageWire {
  id: string;
  mode: string;
  duration_minutes: number;
  price_kobo: number;
  booking?: { total_kobo?: number; totalKobo?: number };
}

export interface VetPackageWire {
  id: string;
  mode: string;
  durationMinutes: number;
  priceKobo: number;
}

export function offerFromDoctorPackage(raw: DoctorPackageWire): ConsultOffer | null {
  const mode = normalizeConsultMode(raw.mode);
  if (!mode) return null;
  const total = raw.booking?.total_kobo ?? raw.booking?.totalKobo ?? 0;
  return {
    id: raw.id,
    mode,
    durationMinutes: raw.duration_minutes,
    priceKobo: raw.price_kobo,
    totalKobo: total > 0 ? total : raw.price_kobo,
  };
}

export function offerFromVetPackage(raw: VetPackageWire): ConsultOffer | null {
  const mode = normalizeConsultMode(raw.mode);
  if (!mode) return null;
  return {
    id: raw.id,
    mode,
    durationMinutes: raw.durationMinutes,
    priceKobo: raw.priceKobo,
    totalKobo: raw.priceKobo,
  };
}

import type { Track, TrackPublication } from 'livekit-client';

/** What `<ConsultVideo>` expects on both platforms: the publication plus the
 *  participant that owns it. Native passes this straight to `VideoTrack`
 *  (`trackRef.publication.track`); web reads `.publication.track` to attach. */
export interface ConsultVideoTrack {
  participant: unknown;
  publication: TrackPublication;
  source: Track.Source.Camera;
}

export type ConsultMediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * `localVideo` / `remoteVideo` stay opaque to the room: web attaches
 * `publication.track` to a <video>, native hands the publication to <VideoTrack>.
 */
export interface ConsultMediaState {
  status: ConsultMediaStatus;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  localVideo: ConsultVideoTrack | null;
  remoteVideo: ConsultVideoTrack | null;
}

export interface ConsultMedia extends ConsultMediaState {
  setMic: (on: boolean) => Promise<void>;
  setCam: (on: boolean) => Promise<void>;
}

/** One price point as the engine's package routes send it. */
export interface ConsultPackageWire {
  id: string;
  owner_kind: 'doctor' | 'health_provider';
  owner_id: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  duration_minutes: number;
  price_kobo: number;
  active: boolean;
}

export interface PublishConsultPackageInput {
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  durationMinutes: number;
  priceKobo: number;
}
