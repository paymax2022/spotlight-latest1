// Web video element for one consult publication. `track.attach` binds the
// WebRTC MediaStream; `detach` releases it when the publication changes.

import React, { useEffect, useRef } from 'react';

export interface ConsultVideoProps {
  publication: unknown;
  label: string;
  mirrored?: boolean;
  muted?: boolean;
}

interface AttachableTrack {
  attach(el: HTMLVideoElement): HTMLVideoElement;
  detach(el?: HTMLVideoElement): void;
}

export default function ConsultVideo({ publication, label, mirrored = false, muted = false }: ConsultVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const track = (publication as { publication?: { track?: AttachableTrack } } | null)?.publication?.track;
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [publication]);

  if (!publication) {
    return React.createElement('div', { style: styles.empty }, label);
  }
  return React.createElement('video', {
    ref,
    autoPlay: true,
    playsInline: true,
    muted,
    style: { ...styles.video, transform: mirrored ? 'scaleX(-1)' : undefined },
  });
}

const styles = {
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: 12,
    backgroundColor: '#000',
  },
  empty: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#d8d2e8',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#1f1b2d',
    borderRadius: 12,
  },
};
