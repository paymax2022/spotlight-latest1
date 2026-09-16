// Native / default stub. Real capture lives in useLocalMedia.web.ts (browser
// getUserMedia). On native, telemedicine video needs react-native-webrtc + a
// signaling/SFU provider (not yet wired) — this keeps the screen type-safe and
// falls back to the placeholder self-view.
export type MediaStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';

export interface LocalMedia {
  stream: unknown | null;
  status: MediaStatus;
  error: string | null;
  setVideoEnabled: (on: boolean) => void;
  setAudioEnabled: (on: boolean) => void;
  stop: () => void;
}

export function useLocalMedia(_enabled: boolean): LocalMedia {
  return {
    stream: null,
    status: 'unsupported',
    error: null,
    setVideoEnabled: () => {},
    setAudioEnabled: () => {},
    stop: () => {},
  };
}
