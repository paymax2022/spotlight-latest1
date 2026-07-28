import React from 'react';
import StateView from '@/components/StateView';
import { STATE_COPY } from '../constants/mobility.constants';

type EdgeKind = keyof typeof STATE_COPY | 'empty';

interface Props {
  kind: EdgeKind;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

/**
 * Maps the standard mobility edge states (offline · service-unavailable ·
 * no-driver-found · payment-failed · restricted · empty) onto the shared
 * StateView so every screen renders them identically. Required by the contract:
 * every screen handles these states.
 */
export default function MobilityEdgeState({ kind, title, message, actionLabel, onAction, compact }: Props) {
  if (kind === 'empty') {
    return (
      <StateView
        kind="empty"
        title={title ?? 'Nothing here yet'}
        message={message}
        actionLabel={actionLabel}
        onAction={onAction}
        compact={compact}
      />
    );
  }
  const copy = STATE_COPY[kind];
  return (
    <StateView
      kind="error"
      icon={copy.icon}
      title={title ?? copy.title}
      message={message ?? copy.message}
      actionLabel={actionLabel}
      onAction={onAction}
      compact={compact}
    />
  );
}
