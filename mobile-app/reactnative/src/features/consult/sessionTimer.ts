// Server-authoritative countdown. The device clock is only used to measure how
// long ago the last server reading arrived: the offset captured at that moment
// is added back on every tick, so a slow or fast phone cannot move the end.

export type TimerPhase = 'ok' | 'warning' | 'expired';

export interface TimerInput {
  endsAt: string;
  warnAt: string;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
  extendable: boolean;
}

export interface ConsultTimer {
  phase: TimerPhase;
  warning: boolean;
  remainingSeconds: number;
  label: string;
  canExtend: boolean;
}

/** Server clock minus device clock, captured when a session payload arrived. */
export function serverOffsetMs(serverNow: string, receivedAtMs: number): number {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server - receivedAtMs : 0;
}

export function formatConsultClock(totalSeconds: number): string {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function consultTimer(input: TimerInput, clientNowMs: number, offsetMs: number): ConsultTimer {
  const projected = clientNowMs + offsetMs;
  const ends = Date.parse(input.endsAt);
  const warn = Date.parse(input.warnAt);
  const ended = input.state === 'ended' || input.state === 'cancelled';
  // An unreadable end is not a licence to keep the camera running: the server
  // would have cut the room, so fail closed here too.
  const expired = ended || !Number.isFinite(ends) || projected >= ends;
  const warning = !expired && Number.isFinite(warn) && projected >= warn;
  const remainingSeconds = expired ? 0 : Math.max(0, Math.ceil((ends - projected) / 1000));
  const phase: TimerPhase = expired ? 'expired' : warning ? 'warning' : 'ok';
  return {
    phase,
    warning,
    remainingSeconds,
    label: formatConsultClock(remainingSeconds),
    canExtend: input.extendable && !expired,
  };
}
