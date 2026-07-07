import React, { useState } from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UserPlus, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCoHostRequests, useRespondCoHost } from '@/features/connect/live/hooks';

const SUGGESTIONS = [
  { id: 'su_1', name: 'Femi', avatar: 'https://i.pravatar.cc/160?u=femi' },
  { id: 'su_2', name: 'Ada', avatar: 'https://i.pravatar.cc/160?u=ada' },
  { id: 'su_3', name: 'Kola', avatar: 'https://i.pravatar.cc/160?u=kola' },
];

/** Invite a co-host / guest + review inbound requests (PRD §10.7 LB-04). */
export default function InviteCoHostScreen() {
  const [query, setQuery] = useState('');
  const [invited, setInvited] = useState<string[]>([]);
  const requestsQ = useCoHostRequests('current');
  const respond = useRespondCoHost('current');

  const filtered = SUGGESTIONS.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Invite co-host" />
      <View style={styles.searchWrap}>
        <SearchBar placeholder="Search followers…" value={query} onChangeText={setQuery} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          (requestsQ.data ?? []).filter((r) => r.status === 'pending').length > 0 ? (
            <View style={styles.reqSection}>
              <Text style={styles.sectionLabel}>Pending requests</Text>
              {(requestsQ.data ?? []).filter((r) => r.status === 'pending').map((r) => (
                <View key={r.id} style={styles.row}>
                  <Image source={{ uri: r.fromAvatar }} style={styles.avatar} />
                  <Text style={styles.name}>{r.fromName}</Text>
                  <Pressable style={styles.declineBtn} onPress={() => respond.mutate({ streamId: 'current', requestId: r.id, accept: false })}>
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>
                  <Pressable style={styles.acceptBtn} onPress={() => respond.mutate({ streamId: 'current', requestId: r.id, accept: true })}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                </View>
              ))}
              <Text style={styles.sectionLabel}>Invite someone</Text>
            </View>
          ) : <Text style={styles.sectionLabel}>Invite someone</Text>
        }
        renderItem={({ item }) => {
          const done = invited.includes(item.id);
          return (
            <View style={styles.row}>
              <Image source={{ uri: item.avatar }} style={styles.avatar} />
              <Text style={styles.name}>{item.name}</Text>
              <Pressable style={[styles.inviteBtn, done && styles.invitedBtn]} onPress={() => setInvited((p) => done ? p : [...p, item.id])} accessibilityLabel={`Invite ${item.name}`}>
                {done ? <Check size={15} color={ConnectColors.ok} strokeWidth={2.4} /> : <UserPlus size={15} color={Colors.onPrimary} strokeWidth={2.2} />}
                <Text style={[styles.inviteText, done && styles.invitedText]}>{done ? 'Invited' : 'Invite'}</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={<StateView kind="empty" icon="Users" title="No matches" message="No followers match that search." compact />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  reqSection: { gap: Spacing.sm },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceContainer },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ConnectColors.brand, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full },
  invitedBtn: { backgroundColor: ConnectColors.okBg },
  inviteText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  invitedText: { color: ConnectColors.ok },
  declineBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: ConnectColors.border },
  declineText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  acceptBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  acceptText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
});
