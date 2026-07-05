import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

// Create tab root (PRD §5 / §10.5 center action). Placeholder — the create agent
// fills Go-Live / Create post / Create event / Start poll (role- & tier-gated).
export default function CreateTab() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create" showBack={false} />
      <StateView
        kind="empty"
        icon="PlusCircle"
        title="Create coming soon"
        message="Go live, post, create an event or start a poll. Some actions are tier-gated."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: Colors.background } });
