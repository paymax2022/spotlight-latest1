import React, { useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from 'react-native';
import { appOrigin } from '@/features/openmic/media';
import { contestantPhotoUri } from '../utils/contestantPhoto';

interface Props {
  /**
   * The wire `photo_url` — the API's contestant-photo reader address, absolute or
   * root-relative depending on the deployment's media base, empty when the server
   * found nothing renderable in the row.
   */
  value?: string | null;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  /** Drawn when there is nothing loadable, and again if the load fails. */
  fallback?: React.ReactElement;
  accessibilityLabel?: string;
}

/**
 * Every contestant picture the voting screens draw, through one door.
 *
 * Two things this replaces, surface by surface: `source={{ uri: contestant.photo }}`
 * handed the server's value straight to an `<Image>`, which left a root-relative
 * reader path resolving against the bundle's own origin, and a ternary on the raw
 * string, which only knew "the column was empty" — not "the address is there and
 * nothing answers it". The second case is not hypothetical: `serveContestantPhoto`
 * 404s for a row whose bytes are on neither the bucket nor the disk it can see, and
 * on the web build a 404 image is an empty well, so a roster page can be full of
 * holes with no error anywhere for anyone to report.
 *
 * Failure is remembered as the uri, not a boolean, so an instance that a re-sorted
 * leaderboard or a new navigation hands a different picture retries: a flag would
 * keep showing initials for a photo that only failed on the previous contestant.
 *
 * The two landing rails are deliberately not here — they draw through `expo-image`
 * with the monogram painted underneath the picture rather than instead of it, and
 * that layering is the reason they need no fallback. They still resolve through
 * `contestantPhotoUri`.
 */
export default function ContestantImage({
  value,
  style,
  resizeMode = 'cover',
  fallback,
  accessibilityLabel,
}: Props) {
  const uri = contestantPhotoUri(value, appOrigin());
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || uri === failedUri) return fallback ?? null;
  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={() => setFailedUri(uri)}
    />
  );
}
