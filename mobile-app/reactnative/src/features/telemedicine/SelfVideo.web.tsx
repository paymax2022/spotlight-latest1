// Live local-camera self-view for the web preview. Renders a real DOM <video>
// bound to the getUserMedia stream. `muted` is required for autoplay and prevents
// hearing your own mic. Falls back to a label when the camera is off / unavailable.
import React, { useEffect, useRef } from 'react';

export interface SelfVideoProps {
  stream: MediaStream | null;
  camOn: boolean;
}

export default function SelfVideo({ stream, camOn }: SelfVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  if (!camOn || !stream) {
    return React.createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
        },
      },
      camOn ? 'Connecting…' : 'Camera off',
    );
  }

  return React.createElement('video', {
    ref,
    autoPlay: true,
    muted: true,
    playsInline: true,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: 12,
      transform: 'scaleX(-1)', // mirror, like every self-view
    },
  });
}
