import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

// Inbox tab root (PRD §5 / §10.3). Placeholder — the messaging agent fills
// matches, conversations and moderated intro requests here.
export default function InboxTab() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Inbox" showBack={false} />
      <StateView
        kind="empty"
        icon="MessageCircle"
        title="No conversations yet"
        message="Matches and messages appear here. You can only chat after a mutual match."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: Colors.background } });
