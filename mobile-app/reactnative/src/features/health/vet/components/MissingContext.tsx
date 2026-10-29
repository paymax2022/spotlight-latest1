import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/tokens';
import { goBack } from '@/lib/navigation';

// Shown when a screen is opened without the appointment/pet/vet it acts on —
// better than writing a record against a made-up id.
export default function MissingContext({ title = 'Missing details', fallback = '/health/vet' }: { title?: string; fallback?: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title={title} />
      <StateView
        kind="error"
        title="We can't open this from here"
        message="Open it from an appointment so we know which visit it belongs to."
        actionLabel="Go back"
        onAction={() => goBack(fallback)}
      />
    </SafeAreaView>
  );
}
