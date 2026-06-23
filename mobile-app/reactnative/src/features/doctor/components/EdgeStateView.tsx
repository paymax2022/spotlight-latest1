import React from 'react';
import * as Icons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import StateView from './StateView';
import { getEdgeState } from '@/api/doctor.batch7.api';
import type { EdgeStateKind, EdgeStateDescriptor } from '@/types/doctor.batch7';

// New component: a thin wrapper that resolves an AD edge-state descriptor
// (via the pure getEdgeState helper / EDGE_STATES map) and renders it through
// the shared StateView. Reuse-first — every empty/error edge state in Section AD
// renders here so screens never author bespoke empty/error views. The descriptor
// carries an Ionicons-style icon name; StateView's empty variant expects a
// LucideIcon, so this maps the descriptor icon onto the closest Lucide glyph.
//
// NEVER a `ref` prop (React-reserved) — none here.

// Ionicons-style descriptor icon name -> Lucide icon component.
const ICON_MAP: Record<string, LucideIcon> = {
  'calendar-outline':            Icons.CalendarDays,
  'chatbubble-ellipses-outline': Icons.MessageSquare,
  'document-text-outline':       Icons.FileText,
  'flask-outline':               Icons.FlaskConical,
  'cash-outline':                Icons.Wallet,
  'star-outline':                Icons.Star,
  'cloud-offline-outline':       Icons.CloudOff,
  'alert-circle-outline':        Icons.AlertCircle,
  'time-outline':                Icons.Clock,
  'videocam-off-outline':        Icons.VideoOff,
  'mic-off-outline':             Icons.MicOff,
  'cloud-upload-outline':        Icons.UploadCloud,
  'person-outline':              Icons.User,
  'close-circle-outline':        Icons.XCircle,
  'cellular-outline':            Icons.SignalLow,
  'sync-outline':                Icons.RefreshCw,
  'warning-outline':             Icons.AlertTriangle,
  'document-lock-outline':       Icons.FileLock,
  'alert-outline':               Icons.AlertTriangle,
  'shield-outline':              Icons.ShieldAlert,
  'hourglass-outline':           Icons.Hourglass,
  'ribbon-outline':              Icons.Award,
  'lock-closed-outline':         Icons.Lock,
  'construct-outline':           Icons.Wrench,
  'arrow-up-circle-outline':     Icons.ArrowUpCircle,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Icons.Info;
}

interface Props {
  // Edge-state kind to resolve, OR pass a pre-resolved descriptor.
  kind?:        EdgeStateKind;
  descriptor?:  EdgeStateDescriptor;
  // Wires the descriptor's primary CTA (retry/refresh) to the screen handler.
  onPrimary?:   () => void;
  // Wires the descriptor's secondary CTA.
  onSecondary?: () => void;
}

export default function EdgeStateView({ kind, descriptor, onPrimary, onSecondary }: Props) {
  const d = descriptor ?? (kind ? getEdgeState(kind) : undefined);
  if (!d) return null;

  if (d.variant === 'error') {
    return (
      <StateView
        variant="error"
        title={d.title}
        message={d.message}
        onRetry={onPrimary ?? onSecondary}
      />
    );
  }

  return (
    <StateView
      variant="empty"
      icon={resolveIcon(d.icon)}
      title={d.title}
      message={d.message}
    />
  );
}
