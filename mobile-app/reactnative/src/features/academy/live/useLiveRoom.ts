// Web / unsupported-platform fallback. LiveKit's React Native SDK is native-only, so on web the
// room reports "unsupported" and never connects. iOS and Android load useLiveRoom.native.ts.
import type { LiveRoomActions, LiveRoomState, UseLiveRoom } from './types';

const state: LiveRoomState = {
  status: 'unsupported',
  end: null,
  error: null,
  participantCount: 0,
  canPublish: false,
  micOn: false,
  camOn: false,
  handUp: false,
  hands: {},
  messages: [],
  stage: null,
};

const actions: LiveRoomActions = {
  sendChat: () => 'not_connected',
  toggleHand: async () => undefined,
  setMic: async () => undefined,
  setCam: async () => undefined,
  leave: async () => undefined,
  rejoin: async () => undefined,
};

export const useLiveRoom: UseLiveRoom = () => ({ ...state, ...actions });
