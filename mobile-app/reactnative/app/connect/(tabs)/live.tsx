import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

// Live tab root (PRD §5 / §10.4). Placeholder — the live-streaming agent fills
// the stream grid, gift drawer and PK battles here.
export default function LiveTab() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Live" showBack={false} />
      <StateView
        kind="empty"
        icon="Radio"
        title="Live streaming coming soon"
        message="Watch creators go live, send gifts and vote. Going live needs Tier 2 verification."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: Colors.background } });
