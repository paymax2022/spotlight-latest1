// iOS / Android room. The SDK setup is confined to this file and
// ConsultVideo.native.tsx; the screens and the web bundle never import it.

import { useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { AudioSession, registerGlobals } from '@livekit/react-native';

import { describeConnectionFailure, parseConnection } from '@/features/academy/live/connection';
import type {
  ConsultJoin,
  ConsultMedia,
  ConsultMediaState,
  ConsultMode,
  ConsultVideoTrack,
} from './types';

let globalsRegistered = false;
function ensureGlobals() {
  if (!globalsRegistered) {
    registerGlobals();
    globalsRegistered = true;
  }
}

// The audio session is process-wide. Serialise start/stop so a leaving room's
// stop cannot silence the next room's start.
let audioChain: Promise<unknown> = Promise.resolve();
const startAudio = () =>
  (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.startAudioSession())) as Promise<void>;
const stopAudio = () =>
  (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.stopAudioSession())) as Promise<void>;

const idle: ConsultMediaState = {
  status: 'idle',
  error: null,
  micOn: false,
  camOn: false,
  localVideo: null,
  remoteVideo: null,
};

function pickVideo(room: Room): Pick<ConsultMediaState, 'localVideo' | 'remoteVideo'> {
  const localPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
  const localVideo: ConsultVideoTrack | null = localPublication
    ? { participant: room.localParticipant, publication: localPublication, source: Track.Source.Camera }
    : null;
  let remoteVideo: ConsultVideoTrack | null = null;
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    if (publication?.track && !publication.isMuted) {
      remoteVideo = { participant, publication, source: Track.Source.Camera };
      break;
    }
  }
  return { localVideo, remoteVideo };
}

export function useConsultMedia(join: ConsultJoin | null, mode: ConsultMode, live: boolean): ConsultMedia {
  const [state, setState] = useState<ConsultMediaState>(idle);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!join || !live || mode === 'chat') {
      setState(idle);
      return;
    }
    const parsed = parseConnection({ token: join.token, rtc: join.rtc }, { allowInsecure: __DEV__ });
    if (!parsed.ok) {
      setState({ ...idle, status: 'failed', error: describeConnectionFailure(parsed.reason) });
      return;
    }

    ensureGlobals();
    let disposed = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setState({ ...idle, status: 'connecting' });

    const patch = (next: Partial<ConsultMediaState>) => {
      if (!disposed) setState((current) => ({ ...current, ...next }));
    };
    const refresh = () => {
      if (disposed) return;
      const local = room.localParticipant;
      patch({
        ...pickVideo(room),
        micOn: local.isMicrophoneEnabled,
        camOn: local.isCameraEnabled,
      });
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (next: ConnectionState) => {
        if (next === ConnectionState.Connected) {
          patch({ status: 'connected' });
          refresh();
        } else if (next === ConnectionState.Connecting) {
          patch({ status: 'connecting' });
        } else if (next === ConnectionState.Reconnecting || next === ConnectionState.SignalReconnecting) {
          patch({ status: 'reconnecting' });
        }
      })
      .on(RoomEvent.Disconnected, () => patch({ status: 'failed', error: 'The consult connection ended. Rejoin to continue.' }))
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantPermissionsChanged, refresh)
      .on(RoomEvent.MediaDevicesError, (e: Error) =>
        patch({ error: e?.message || 'Camera or microphone is unavailable.' }));

    void (async () => {
      try {
        await startAudio();
        await room.connect(parsed.connection.url, parsed.connection.token, { autoSubscribe: true });
        if (disposed) {
          await room.disconnect();
          return;
        }
        if (mode === 'video') await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (disposed) return;
        setState((current) => ({
          ...current,
          status: 'connected',
          ...pickVideo(room),
          micOn: room.localParticipant.isMicrophoneEnabled,
          camOn: room.localParticipant.isCameraEnabled,
        }));
      } catch (e) {
        patch({ status: 'failed', error: e instanceof Error ? e.message : 'Could not connect to the consult.' });
      }
    })();

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      void stopAudio();
      roomRef.current = null;
    };
  }, [join, live, mode]);

  const setMic = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Microphone permission was denied.' }));
    }
    setState((current) => ({ ...current, micOn: roomRef.current?.localParticipant.isMicrophoneEnabled ?? false }));
  };

  const setCam = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Camera permission was denied.' }));
    }
    const room = roomRef.current;
    setState((current) => ({
      ...current,
      camOn: room?.localParticipant.isCameraEnabled ?? false,
      ...(room ? pickVideo(room) : {}),
    }));
  };

  return { ...state, setMic, setCam };
}
