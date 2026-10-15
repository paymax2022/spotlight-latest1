// The live video area. iOS / Android only (imports the native SDK).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoTrack } from '@livekit/react-native';
import type { StageTrack } from './types';

type TrackRef = React.ComponentProps<typeof VideoTrack>['trackRef'];

export function LiveStage({ stage }: { stage: StageTrack | null }) {
  if (!stage) {
    return (
      <View style={styles.empty} accessibilityLabel="No video yet">
        <Text style={styles.emptyText}>Waiting for the host to start their camera…</Text>
      </View>
    );
  }
  const ref = stage as TrackRef & { participant?: { isLocal?: boolean } };
  // Your own front camera is shown mirrored, like a mirror; remote video never is.
  return <VideoTrack trackRef={ref} style={styles.video} objectFit="cover" mirror={ref?.participant?.isLocal === true} />;
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  empty: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#1f1b2d', alignItems: 'center', justifyContent: 'center', padding: 16 },
  emptyText: { color: '#d8d2e8', textAlign: 'center' },
});
