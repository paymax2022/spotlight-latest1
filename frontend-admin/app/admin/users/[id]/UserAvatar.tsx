'use client';

import { useState } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Circular profile photo; shows initials when there is no src or it fails to load. */
export function UserAvatar({ name, src, size = 72 }: { name: string; src?: string; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const box = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        onError={() => setFailedSrc(src ?? null)}
        style={{ ...box, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tint(colors.primary, 0.12),
        color: colors.primary,
        fontWeight: 600,
        fontSize: Math.round(size / 3),
      }}
    >
      {initials(name)}
    </div>
  );
}
