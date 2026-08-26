import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Heart, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';

/**
 * "It's a match!" celebration (PRD §10.2 DC-06). SAFETY §4: messaging is ONLY
 * reachable from here because a mutual match just occurred — there is no other
 * entry from discovery into chat.
 */
export default function MatchModalScreen() {
  const { threadId, name } = useLocalSearchParams<{
    matchId?: string;
    threadId?: string;
    profileId?: string;
    name?: string;
  }>();

  const matchName = name && name.length ? name : 'them';

  function openMessage() {
    if (threadId && threadId.length) {
      router.push(`/connect/messaging/thread?threadId=${threadId}`);
    } else {
      router.push('/connect/messaging/inbox');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={styles.body}>
        <View style={styles.iconStack}>
          <View style={[styles.avatarCircle, styles.avatarLeft]}>
            <Heart size={30} color={ConnectColors.brand} strokeWidth={2} fill={Colors.iconBgPurple} />
          </View>
          <View style={[styles.avatarCircle, styles.avatarRight]}>
            <Sparkles size={30} color={Colors.gold} strokeWidth={2} />
          </View>
        </View>

        <Text style={styles.title}>It's a match!</Text>
        <Text style={styles.subtitle}>You and {matchName} liked each other.</Text>

        <View style={styles.actions}>
          <PrimaryButton label="Send a message" onPress={openMessage} />
          <PrimaryButton label="Keep swiping" variant="ghost" onPress={() => goBack('/connect')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  iconStack: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  avatarCircle: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: ConnectColors.brand,
  },
  avatarLeft: { marginRight: -16, zIndex: 2 },
  avatarRight: { marginLeft: -16, borderColor: Colors.gold },
  title: { ...Typography.displayLg, color: ConnectColors.brand, textAlign: 'center', fontSize: 36 },
  subtitle: { ...Typography.bodyLg, color: ConnectColors.muted, textAlign: 'center' },
  actions: { width: '100%', gap: Spacing.sm, marginTop: Spacing.lg },
});
