// Shared by the native implementation (useLiveRoom.native.ts) and the web fallback
// (useLiveRoom.ts) so both expose exactly the same surface.
import type { ChatMessage, Hands } from './dataMessages';
import type { Connection } from './connection';
import type { DisconnectInfo } from './disconnect';

export type RoomStatus =
  | 'idle'          // nothing to connect to yet
  | 'connecting'
  | 'connected'
  | 'reconnecting'  // the SDK is recovering a dropped connection by itself
  | 'ended'         // final: left, class over, removed, signed in elsewhere
  | 'failed'        // could not connect / lost; may be retryable
  | 'unsupported';  // this platform cannot run LiveKit (web)

export type SendResult = 'sent' | 'invalid' | 'rate_limited' | 'not_connected';

/** The participant whose video fills the stage; opaque to the screen. */
export type StageTrack = unknown;

export interface LiveRoomState {
  status: RoomStatus;
  end: DisconnectInfo | null;
  error: string | null;
  /** Everyone in the room including you. */
  participantCount: number;
  /** Whether LiveKit lets THIS user publish (a host does; an attendee does not). */
  canPublish: boolean;
  micOn: boolean;
  camOn: boolean;
  handUp: boolean;
  hands: Hands;
  messages: ChatMessage[];
  stage: StageTrack | null;
}

export interface LiveRoomActions {
  sendChat(body: string): SendResult;
  toggleHand(): Promise<void>;
  setMic(on: boolean): Promise<void>;
  setCam(on: boolean): Promise<void>;
  leave(): Promise<void>;
  /** Fetches a fresh token from the API and reconnects. */
  rejoin(): Promise<void>;
}

export interface UseLiveRoomArgs {
  connection: Connection | null;
  /** Called to get a new token + URL (expired token, retry). null = cannot rejoin. */
  fetchConnection: () => Promise<Connection | null>;
  /** Display name for your own messages. */
  selfName?: string;
}

export type UseLiveRoom = (args: UseLiveRoomArgs) => LiveRoomState & LiveRoomActions;
