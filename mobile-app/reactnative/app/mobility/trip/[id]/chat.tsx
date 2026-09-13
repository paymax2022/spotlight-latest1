import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import ScreenHeader from '@/components/ScreenHeader';
import TripChatThread from '@/features/mobility/components/TripChatThread';

export default function TripChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Message driver" />
      {id ? <TripChatThread tripId={id} myRole="rider" /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});
