export type BootcampStatus =
  | 'upcoming'
  | 'open_for_applications'
  | 'full'
  | 'ongoing'
  | 'completed';

export function resolveBootcampStatus(input: {
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  application_deadline?: string | null;
  seat_limit?: number | null;
  seats_filled?: number | null;
}): BootcampStatus {
  const explicit = (input.status || '').trim() as BootcampStatus;
  if (
    explicit === 'upcoming' ||
    explicit === 'open_for_applications' ||
    explicit === 'full' ||
    explicit === 'ongoing' ||
    explicit === 'completed'
  ) {
    return explicit;
  }

  const now = Date.now();
  const startAt = input.start_at ? new Date(input.start_at).getTime() : Number.NaN;
  const endAt = input.end_at ? new Date(input.end_at).getTime() : Number.NaN;
  const deadlineAt = input.application_deadline
    ? new Date(input.application_deadline).getTime()
    : Number.NaN;
  const seatLimit = Number.isFinite(Number(input.seat_limit)) ? Number(input.seat_limit) : 0;
  const seatsFilled = Number.isFinite(Number(input.seats_filled)) ? Number(input.seats_filled) : 0;

  if (Number.isFinite(endAt) && endAt < now) return 'completed';
  if (Number.isFinite(startAt) && startAt <= now && (!Number.isFinite(endAt) || endAt >= now)) {
    return 'ongoing';
  }
  if (seatLimit > 0 && seatsFilled >= seatLimit) return 'full';
  if (Number.isFinite(deadlineAt) && deadlineAt >= now) return 'open_for_applications';
  return 'upcoming';
}

export function bootcampStatusLabel(status: BootcampStatus): string {
  if (status === 'open_for_applications') return 'Open for Applications';
  if (status === 'full') return 'Full';
  if (status === 'ongoing') return 'Ongoing';
  if (status === 'completed') return 'Completed';
  return 'Upcoming';
}
