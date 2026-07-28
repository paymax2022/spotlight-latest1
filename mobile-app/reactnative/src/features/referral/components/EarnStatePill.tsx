import React from 'react';
import StateBadge, { BadgeTone } from './StateBadge';
import { EARN_STATE_META, EarnStateKey } from '../constants/referral.constants';

interface Props {
  state: EarnStateKey;
}

/**
 * Reward-ledger state pill (earned → pending → vesting → eligible → paid →
 * clawed-back, PRD §7). Shared so RM2's earnings screens render states the same
 * way the foundation does.
 */
export default function EarnStatePill({ state }: Props) {
  const meta = EARN_STATE_META[state];
  return <StateBadge label={meta.label} tone={meta.tone as BadgeTone} />;
}
