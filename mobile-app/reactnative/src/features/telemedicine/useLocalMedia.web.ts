// Real browser capture for the consult self-view. Acquires camera + mic via
// getUserMedia (localhost/https is a secure context, so this works in the web
// preview). Toggling cam/mic flips the real track's `enabled`; tracks are stopped
// on unmount / end so the camera light goes off.
import { useCallback, useEffect, useRef, useState } from 'react';

export type MediaStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';

export interface LocalMedia {
  stream: MediaStream | null;
  status: MediaStatus;
  error: string | null;
  setVideoEnabled: (on: boolean) => void;
  setAudioEnabled: (on: boolean) => void;
  stop: () => void;
}

export function useLocalMedia(enabled: boolean): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    let cancelled = false;
    setStatus('requesting');
    md.getUserMedia({ video: true, audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
        setError((e as { message?: string })?.message ?? 'Could not access camera or microphone');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Release the camera/mic when the component unmounts.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  const setVideoEnabled = useCallback((on: boolean) => {
    streamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
  }, []);

  const setAudioEnabled = useCallback((on: boolean) => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = on;
    });
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  return { stream, status, error, setVideoEnabled, setAudioEnabled, stop };
}
