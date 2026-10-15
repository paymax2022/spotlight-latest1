// LiveKit room for iOS / Android. Everything the SDK needs is confined to this file and
// LiveStage.native.tsx, so the screens, the pure modules and the web bundle never import it.
//
// The decisions live in pure, unit-tested modules; this file only wires the SDK to them:
//  - connectFlow.runConnect: token freshness, and no connection survives its owner leaving;
//  - connection.parseConnection (called by the screen): only a LiveKit response is dialled;
//  - dataMessages: incoming data is sanitised, attributed by LiveKit's identity and rate limited per
//    sender; what this device sends is rate limited too;
//  - disconnect.classifyDisconnect: class over / removed / signed in elsewhere are final;
//  - stage.selectStageIdentity: a participant allowed to publish (the host) owns the stage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import type { Participant, RemoteParticipant } from 'livekit-client';
import { AudioSession, registerGlobals } from '@livekit/react-native';
import type { Connection } from './connection';
import { runConnect } from './connectFlow';
import {
  CHAT_TOPIC, HAND_TOPIC, appendChat, applyHand, createRateLimiter, createSenderLimiter, decodeChat, decodeHand,
  encodeChat, encodeHand, sanitizeText,
} from './dataMessages';
import type { ChatMessage } from './dataMessages';
import { classifyDisconnect } from './disconnect';
import type { DisconnectInfo } from './disconnect';
import { selectStageIdentity } from './stage';
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

// The native audio session is a single shared resource. A stop from one room and a start from the
// next must not interleave (a late stop would silence the new room), so they run strictly in order.
let audioChain: Promise<unknown> = Promise.resolve();
const audioStart = () => (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.startAudioSession())) as Promise<void>;
const audioStop = () => (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.stopAudioSession())) as Promise<void>;

const MAX_MESSAGES = 200;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const idle: LiveRoomState = {
  status: 'idle', end: null, error: null, participantCount: 0, canPublish: false, micOn: false, camOn: false,
  handUp: false, hands: {}, messages: [], stage: null,
};

/** The camera track to feature (see selectStageIdentity). */
function pickStage(room: Room): LiveRoomState['stage'] {
  const self = room.localParticipant;
  const all: Participant[] = [self, ...room.remoteParticipants.values()];
  const cams = new Map<string, ReturnType<Participant['getTrackPublication']>>();
  const id = selectStageIdentity(
    all.map((p) => {
      const pub = p.getTrackPublication(Track.Source.Camera);
      const has = !!pub && !!pub.track && !pub.isMuted;
      if (has) cams.set(p.identity, pub);
      return { identity: p.identity, hasCamera: has, canPublish: p.permissions?.canPublish === true };
    }),
    self.identity,
  );
  const p = all.find((x) => x.identity === id);
  const pub = id ? cams.get(id) : undefined;
  return p && pub ? { participant: p, publication: pub, source: Track.Source.Camera } : null;
}

const senderOf = (p: Participant | undefined) => (p ? { identity: p.identity, name: p.name } : undefined);

export const useLiveRoom: UseLiveRoom = (args: UseLiveRoomArgs): LiveRoomState & LiveRoomActions => {
  const { connection: initial, fetchConnection, selfName } = args;
  const [state, setState] = useState<LiveRoomState>(idle);
  const [connection, setConnection] = useState<Connection | null>(initial);
  const roomRef = useRef<Room | null>(null);
  const handUpRef = useRef(false);
  const allowChat = useRef(createRateLimiter({ max: 5, windowMs: 10_000 })).current;
  const allowFromSender = useRef(createSenderLimiter({ max: 8, windowMs: 5_000, maxSenders: 500 })).current;
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
    handUpRef.current = false;
    // A new room starts with a clean slate for hands (they belong to the previous room), but the
    // chat transcript is kept across a rejoin.
    setState((s) => ({ ...idle, messages: s.messages, status: 'connecting' }));

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
        if (!disposed) setState((s) => ({ ...s, hands: applyHand(s.hands, { identity: p.identity, left: true }) }));
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
        if (disposed || !participant || (topic !== CHAT_TOPIC && topic !== HAND_TOPIC)) return;
        if (!allowFromSender(participant.identity)) return; // one remote cannot flood this device's UI
        if (topic === CHAT_TOPIC) {
          const m = decodeChat(payload, senderOf(participant), Date.now());
          if (m) setState((s) => ({ ...s, messages: appendChat(s.messages, m, MAX_MESSAGES) }));
        } else {
          const h = decodeHand(payload, senderOf(participant));
          if (h) setState((s) => ({ ...s, hands: applyHand(s.hands, h) }));
        }
      });

    void runConnect({
      connection,
      now: Date.now,
      fetchFresh: () => fetchRef.current(),
      startAudio: audioStart,
      connect: (c) => room.connect(c.url, c.token, { autoSubscribe: true }),
      disconnect: () => room.disconnect(),
      isDisposed: () => disposed,
    }).then((out) => {
      if (disposed) return;
      if (out.kind === 'connected') refresh();
      else if (out.kind === 'expired') patch({ status: 'failed', error: 'Your session expired. Please rejoin the class.' });
      else if (out.kind === 'failed') patch({ status: 'failed', error: out.message });
    });

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      void audioStop();
      roomRef.current = null;
    };
  }, [connection, allowFromSender]);

  const sendChat = useCallback((body: string): SendResult => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return 'not_connected';
    const id = newId();
    const bytes = encodeChat(body, id);
    if (!bytes) return 'invalid';
    if (!allowChat()) return 'rate_limited';
    const mine: ChatMessage = {
      id, from: room.localParticipant.identity, name: selfName || 'You', body: sanitizeText(body), at: Date.now(), self: true,
    };
    // Show your own message only once it has actually gone out (LiveKit does not echo it back).
    room.localParticipant.publishData(bytes, { reliable: true, topic: CHAT_TOPIC }).then(
      () => setState((s) => ({ ...s, messages: appendChat(s.messages, mine, MAX_MESSAGES) })),
      () => setState((s) => ({ ...s, error: 'Your message could not be sent.' })),
    );
    return 'sent';
  }, [allowChat, selfName]);

  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const up = !handUpRef.current;
    handUpRef.current = up; // a ref, so a fast double tap flips twice instead of sending the same value twice
    setState((s) => ({ ...s, handUp: up }));
    try {
      await room.localParticipant.publishData(encodeHand(up), { reliable: true, topic: HAND_TOPIC });
    } catch {
      handUpRef.current = !up;
      setState((s) => ({ ...s, handUp: !up, error: 'Could not update your raised hand.' }));
    }
  }, []);

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
    if (fresh) setConnection({ ...fresh }); // a new object: re-runs the connect effect
    else setState((s) => ({ ...s, status: 'failed', error: 'Could not rejoin the class.' }));
  }, []);

  return useMemo(
    () => ({ ...state, sendChat, toggleHand, setMic, setCam, leave, rejoin }),
    [state, sendChat, toggleHand, setMic, setCam, leave, rejoin],
  );
};
