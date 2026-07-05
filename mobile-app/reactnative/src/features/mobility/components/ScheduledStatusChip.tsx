import React from 'react';
import StatusBadge from './StatusBadge';
import { SCHEDULED_STATUS_LABEL } from '../constants/modes.constants';
import type { ScheduledStatus } from '../api/scheduled.api';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

function toneFor(status: ScheduledStatus): Tone {
  switch (status) {
    case 'completed': return 'success';
    case 'dispatched': return 'info';
    case 'dispatch_pending': return 'warning';
    case 'cancelled':
    case 'failed_no_driver':
    case 'expired': return 'danger';
    default: return 'neutral';
  }
}

/** Status pill for a scheduled logistics booking (namespaced Scheduled* component). */
export default function ScheduledStatusChip({ status }: { status: ScheduledStatus }) {
  return <StatusBadge label={SCHEDULED_STATUS_LABEL[status]} tone={toneFor(status)} />;
}
