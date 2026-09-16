// Native / default self-view placeholder. The live-camera version is
// SelfVideo.web.tsx (renders a real <video>). Props are shared so the screen
// stays platform-agnostic.
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { VideoOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';

export interface SelfVideoProps {
  stream: unknown | null;
  camOn: boolean;
}

export default function SelfVideo({ camOn }: SelfVideoProps) {
  return camOn ? (
    <Text style={styles.text}>You</Text>
  ) : (
    <VideoOff size={20} color={Colors.white} strokeWidth={2} />
  );
}

const styles = StyleSheet.create({
  text: { ...Typography.labelMd, color: Colors.white },
});
