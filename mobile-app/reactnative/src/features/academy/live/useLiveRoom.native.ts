// LiveKit room for iOS / Android. Everything the SDK needs is confined to this file and
// LiveStage.native.tsx, so the screens, the pure modules and the web bundle never import it.
//
// Safety properties (each backed by a pure, unit-tested module):
//  - only a connection that parseConnection() accepted is dialled;
//  - incoming data is sanitised and attributed by LiveKit's participant identity, never the payload;
//  - what this device sends is rate limited and bounded;
//  - a class that ended, or a removal by the host, is final: no retry loop.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import type { Participant, RemoteParticipant } from 'livekit-client';
import { AudioSession, registerGlobals } from '@livekit/react-native';
import { isTokenUsable } from './connection';
import type { Connection } from './connection';
import {
  CHAT_TOPIC, HAND_TOPIC, appendChat, applyHand, createRateLimiter, decodeChat, decodeHand, encodeChat, encodeHand, sanitizeText,
} from './dataMessages';
import type { ChatMessage, Hands } from './dataMessages';
import { classifyDisconnect } from './disconnect';
import type { DisconnectInfo } from './disconnect';
import type { LiveRoomActions, LiveRoomState, RoomStatus, SendResult, UseLiveRoom, UseLiveRoomArgs } from './types';

// Installs the WebRTC globals LiveKit needs. Idempotent; done once, lazily, on first use of a room
// (not at app start), so a build without the native module only breaks the live-class screen.
let globalsRegistered = false;
function ensureGlobals() {
  if (!globalsRegistered) {
    registerGlobals();
    globalsRegistered = true;
  }
}

const MAX_MESSAGES = 200;
const TOKEN_SKEW_MS = 15_000;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const idle: LiveRoomState = {
  status: 'idle', end: null, error: null, participantCount: 0, canPublish: false, micOn: false, camOn: false,
  handUp: false, hands: {}, messages: [], stage: null,
};

/** The camera track to feature: a remote publisher first (the host), else yourself. */
function pickStage(room: Room): LiveRoomState['stage'] {
  for (const p of room.remoteParticipants.values()) {
    const pub = p.getTrackPublication(Track.Source.Camera);
    if (pub && pub.track && !pub.isMuted) return { participant: p, publication: pub, source: Track.Source.Camera };
  }
  const me = room.localParticipant;
  const mine = me.getTrackPublication(Track.Source.Camera);
  if (mine && mine.track && !mine.isMuted) return { participant: me, publication: mine, source: Track.Source.Camera };
  return null;
}

const senderOf = (p: Participant | undefined) => (p ? { identity: p.identity, name: p.name } : undefined);

export const useLiveRoom: UseLiveRoom = (args: UseLiveRoomArgs): LiveRoomState & LiveRoomActions => {
  const { connection: initial, fetchConnection, selfName } = args;
  const [state, setState] = useState<LiveRoomState>(idle);
  const [connection, setConnection] = useState<Connection | null>(initial);
  const roomRef = useRef<Room | null>(null);
  const allowChat = useRef(createRateLimiter({ max: 5, windowMs: 10_000 })).current;
  const fetchRef = useRef(fetchConnection);
  fetchRef.current = fetchConnection;

  useEffect(() => { setConnection(initial); }, [initial]);

  useEffect(() => {
    if (!connection) {
      setState(idle);
      return;
    }
    let disposed = false;
    ensureGlobals();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const patch = (p: Partial<LiveRoomState>) => { if (!disposed) setState((s) => ({ ...s, ...p })); };
    const refresh = () => {
      if (disposed) return;
      const lp = room.localParticipant;
      patch({
        participantCount: room.remoteParticipants.size + 1,
        canPublish: lp.permissions?.canPublish === true,
        micOn: lp.isMicrophoneEnabled,
        camOn: lp.isCameraEnabled,
        stage: pickStage(room),
      });
    };
    const status = (s: RoomStatus) => patch({ status: s });

    room
      .on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
        if (s === ConnectionState.Connected) { status('connected'); refresh(); }
        else if (s === ConnectionState.Connecting) status('connecting');
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) status('reconnecting');
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        const info: DisconnectInfo = classifyDisconnect(reason === undefined ? undefined : DisconnectReason[reason]);
        patch({ status: info.canRetry ? 'failed' : 'ended', end: info, stage: null });
      })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        setState((s) => ({ ...s, hands: applyHand(s.hands, { identity: p.identity, left: true }) }));
        refresh();
      })
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantPermissionsChanged, refresh)
      .on(RoomEvent.MediaDevicesError, (e: Error) => patch({ error: e?.message || 'Camera or microphone is unavailable.' }))
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic === CHAT_TOPIC) {
          const m = decodeChat(payload, senderOf(participant), Date.now());
          if (m) setState((s) => ({ ...s, messages: appendChat(s.messages, m, MAX_MESSAGES) }));
        } else if (topic === HAND_TOPIC) {
          const h = decodeHand(payload, senderOf(participant));
          if (h) setState((s) => ({ ...s, hands: applyHand(s.hands, h) }));
        }
      });

    (async () => {
      try {
        let conn = connection;
        // A token that has expired (or is about to) can only fail: get a fresh one first.
        if (!isTokenUsable(conn.token, Date.now(), TOKEN_SKEW_MS)) {
          const fresh = await fetchRef.current();
          if (!fresh) { patch({ status: 'failed', error: 'Your session expired. Please rejoin the class.' }); return; }
          conn = fresh;
        }
        patch({ status: 'connecting', end: null, error: null });
        await AudioSession.startAudioSession();
        await room.connect(conn.url, conn.token, { autoSubscribe: true });
        refresh();
      } catch (e) {
        patch({ status: 'failed', error: e instanceof Error ? e.message : 'Could not connect to the class.' });
      }
    })();

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      void AudioSession.stopAudioSession();
      roomRef.current = null;
    };
  }, [connection]);

  const sendChat = useCallback((body: string): SendResult => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return 'not_connected';
    const id = newId();
    const bytes = encodeChat(body, id);
    if (!bytes) return 'invalid';
    if (!allowChat()) return 'rate_limited';
    void room.localParticipant.publishData(bytes, { reliable: true, topic: CHAT_TOPIC });
    // LiveKit does not echo your own data messages back, so add it locally.
    const mine: ChatMessage = {
      id, from: room.localParticipant.identity, name: selfName || 'You', body: sanitizeText(body),
      at: Date.now(), self: true,
    };
    setState((s) => ({ ...s, messages: appendChat(s.messages, mine, MAX_MESSAGES) }));
    return 'sent';
  }, [allowChat, selfName]);

  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const up = !state.handUp;
    await room.localParticipant.publishData(encodeHand(up), { reliable: true, topic: HAND_TOPIC });
    setState((s) => ({ ...s, handUp: up }));
  }, [state.handUp]);

  const setMic = useCallback(async (on: boolean) => {
    try { await roomRef.current?.localParticipant.setMicrophoneEnabled(on); }
    catch (e) { setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Microphone permission was denied.' })); }
    setState((s) => ({ ...s, micOn: roomRef.current?.localParticipant.isMicrophoneEnabled ?? false }));
  }, []);

  const setCam = useCallback(async (on: boolean) => {
    try { await roomRef.current?.localParticipant.setCameraEnabled(on); }
    catch (e) { setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Camera permission was denied.' })); }
    setState((s) => ({ ...s, camOn: roomRef.current?.localParticipant.isCameraEnabled ?? false }));
  }, []);

  const leave = useCallback(async () => { await roomRef.current?.disconnect(); }, []);

  const rejoin = useCallback(async () => {
    const fresh = await fetchRef.current();
    if (fresh) setConnection({ ...fresh }); // new object: re-runs the connect effect
    else setState((s) => ({ ...s, status: 'failed', error: 'Could not rejoin the class.' }));
  }, []);

  return useMemo(
    () => ({ ...state, sendChat, toggleHand, setMic, setCam, leave, rejoin }),
    [state, sendChat, toggleHand, setMic, setCam, leave, rejoin],
  );
};
