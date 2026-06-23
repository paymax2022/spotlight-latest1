import React from 'react';
import { ViewStyle } from 'react-native';
import StatusBadge from './StatusBadge';
import { VERIFICATION_META } from '../constants/realtor.constants';
import type { VerificationLevel } from '../types/realtor.types';

interface Props {
  level: VerificationLevel;
  style?: ViewStyle;
}

/** Trust-layer chip — the anti-scam signal surfaced on cards & detail. */
export default function VerificationBadge({ level, style }: Props) {
  const m = VERIFICATION_META[level];
  return <StatusBadge label={m.label} tone={m.tone} icon={m.icon} style={style} />;
}
