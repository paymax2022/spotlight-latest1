import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';
import { View } from 'react-native';
import ModuleTabBar from '@/components/ModuleTabBar';
import { CONNECT_VOTING_TABS } from '@/constants/moduleTabs';

// This subtree previously had no _layout.tsx of its own, so it inherited
// app/connect/_layout.tsx's bare, un-tabbed Stack — zero bottom nav on any of
// these 7 screens. Mirrors app/voting/_layout.tsx's pattern: a module-scoped
// ModuleTabBar as a sibling of the Stack, showing only on the landing/browse
// screens (contests, leaderboard, my-votes, results).
export default function ConnectVotingLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown:  false,
          contentStyle: { backgroundColor: Colors.background },
          animation:    'slide_from_right',
        }}
      >
        <Stack.Screen name="contests"     />
        <Stack.Screen name="contest-detail" />
        <Stack.Screen name="leaderboard"  />
        <Stack.Screen name="my-votes"     />
        <Stack.Screen name="results"      />
        <Stack.Screen name="paid-vote"    />
        <Stack.Screen name="vote-modal"   options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      <ModuleTabBar tabs={CONNECT_VOTING_TABS} />
    </View>
  );
}
