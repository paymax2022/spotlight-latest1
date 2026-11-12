// Native video for one consult publication. VideoTrack takes the publication
// (a TrackReference), which is exactly what the media hook stores.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoTrack } from '@livekit/react-native';

type TrackRef = React.ComponentProps<typeof VideoTrack>['trackRef'];

export interface ConsultVideoProps {
  publication: unknown;
  label: string;
  mirrored?: boolean;
  muted?: boolean;
}

export default function ConsultVideo({ publication, label, mirrored = false }: ConsultVideoProps) {
  const trackRef = publication as TrackRef | null;
  if (!trackRef) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{label}</Text>
      </View>
    );
  }
  return <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" mirror={mirrored} />;
}

const styles = StyleSheet.create({
  video: { width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  empty: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: '#1f1b2d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyText: { color: '#d8d2e8', textAlign: 'center' },
});
