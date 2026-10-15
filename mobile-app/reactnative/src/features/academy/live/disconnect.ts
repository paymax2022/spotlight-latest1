// Maps a LiveKit DisconnectReason NAME (the enum's string key) to what the learner should see and
// whether trying again is sensible. Pure; the hook passes `DisconnectReason[reason]`.

export type EndKind = 'left' | 'class_ended' | 'removed' | 'signed_in_elsewhere' | 'network' | 'unknown';

export interface DisconnectInfo {
  kind: EndKind;
  message: string;
  /** True when a fresh join (new token from the API) may succeed. */
  canRetry: boolean;
}

export function classifyDisconnect(reason: string | undefined): DisconnectInfo {
  switch (reason) {
    case 'CLIENT_INITIATED':
      return { kind: 'left', message: 'You left the class.', canRetry: false };
    case 'ROOM_DELETED':
    case 'ROOM_CLOSED':
      return { kind: 'class_ended', message: 'This class has ended.', canRetry: false };
    case 'PARTICIPANT_REMOVED':
      return { kind: 'removed', message: 'You were removed from this class by the host.', canRetry: false };
    case 'DUPLICATE_IDENTITY':
      return { kind: 'signed_in_elsewhere', message: 'You joined this class on another device, so this one was disconnected.', canRetry: false };
    case 'SERVER_SHUTDOWN':
    case 'STATE_MISMATCH':
    case 'JOIN_FAILURE':
    case 'MIGRATION':
    case 'SIGNAL_CLOSE':
    case 'CONNECTION_TIMEOUT':
    case 'MEDIA_FAILURE':
      return { kind: 'network', message: 'The connection was lost.', canRetry: true };
    default:
      return { kind: 'unknown', message: 'You were disconnected from the class.', canRetry: true };
  }
}
