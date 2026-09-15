// ── Paymax Media — RemoteBanner ──────────────────────────────────────────────
// Renders a marketing banner whose artwork lives in Cloudflare R2, fetched via a
// short-lived presigned URL from the gateway's banner resolver.
//
// Behaviour is deliberately quiet: the banner is decoration, so while it loads
// the component reserves its exact aspect ratio (no layout shift when the image
// pops in), and if the resolver or the image fails it renders NOTHING rather
// than an error card. A screen must never look broken because a picture didn't
// arrive.

import React, { useState } from 'react';
import { View, Image, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { useBanner } from '../hooks';

type Props = {
  /** Banner slug registered in the gateway resolver, e.g. 'health-vet'. */
  slug: string;
  /** Optional tap target (e.g. the banner's call to action). */
  onPress?: () => void;
  /** Override the alt text the server ships with the artwork. */
  accessibilityLabel?: string;
  style?: object;
};

export default function RemoteBanner({ slug, onPress, accessibilityLabel, style }: Props) {
  const { data, isLoading, isError } = useBanner(slug);
  const [imageFailed, setImageFailed] = useState(false);

  if (isError || imageFailed) return null;

  // Fall back to the 8:3 artwork ratio while the descriptor is in flight so the
  // placeholder occupies exactly the space the image will.
  const aspectRatio = data?.aspectRatio ?? 8 / 3;

  const body = (
    <View style={[styles.frame, { aspectRatio }, style]}>
      {data ? (
        <Image
          source={{ uri: data.url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel ?? data.alt}
        />
      ) : isLoading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? data?.alt}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
