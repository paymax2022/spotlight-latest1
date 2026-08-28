import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Vote, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCastFreeVote } from '@/features/connect/voting/hooks';

/** Free vote confirmation (PRD §10.8 VT-03, free path). No money moves. */
export default function VoteModalScreen() {
  const { contestId, contestantId, name } = useLocalSearchParams<{ contestId: string; contestantId: string; name: string }>();
  const cast = useCastFreeVote(contestId ?? '');
  const [done, setDone] = useState(false);

  function submit() {
    cast.mutate({ contestId: contestId ?? '', contestantId: contestantId ?? '' }, { onSuccess: () => setDone(true) });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Free vote" showBack={!done} />
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          {done ? <CircleCheck size={36} color={ConnectColors.ok} strokeWidth={2} /> : <Vote size={36} color={ConnectColors.ok} strokeWidth={2} />}
        </View>
        {done ? (
          <>
            <Text style={styles.title}>Vote counted!</Text>
            <Text style={styles.sub}>Your free vote for {name} has been recorded.</Text>
            <View style={styles.btnWrap}><PrimaryButton label="Back to contest" onPress={() => goBack('/connect')} /></View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Vote for {name}?</Text>
            <Text style={styles.sub}>This is a free vote — no money is involved. One free vote per contestant.</Text>
            <View style={styles.noteBox}>
              <Text style={styles.note}>Free votes are rate-limited and protected against bots to keep results fair.</Text>
            </View>
            <View style={styles.btnWrap}>
              <PrimaryButton label={cast.isPending ? 'Voting…' : 'Cast free vote'} loading={cast.isPending} onPress={submit} />
            </View>
            {cast.isError ? <Text style={styles.err}>Couldn't record your vote. Try again.</Text> : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: ConnectColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  noteBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  btnWrap: { width: '100%', marginTop: Spacing.lg },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
});
