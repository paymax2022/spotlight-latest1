import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';
import { View } from 'react-native';
import ModuleTabBar from '@/components/ModuleTabBar';
import { VOTING_TABS } from '@/constants/moduleTabs';

export default function VotingLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
      screenOptions={{
        headerShown:       false,
        contentStyle:      { backgroundColor: Colors.background },
        animation:         'slide_from_right',
      }}
    >
      <Stack.Screen name="index"                 />
      <Stack.Screen name="contests"              />
      <Stack.Screen name="contest-details"       />
      <Stack.Screen name="contestants"           />
      <Stack.Screen name="contestant-profile"    />
      <Stack.Screen name="buy-votes"             />
      <Stack.Screen name="payment-method"        />
      <Stack.Screen name="payment-processing"    />
      <Stack.Screen name="vote-success"          />
      <Stack.Screen name="vote-failed"           />
      <Stack.Screen name="leaderboard"           />
      <Stack.Screen name="my-votes"              />
      <Stack.Screen name="vote-receipt"          />
      <Stack.Screen name="contestant-dashboard"  />
      <Stack.Screen name="notifications"         />
      <Stack.Screen name="rules"                 options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="support"               options={{ animation: 'slide_from_bottom' }} />
    </Stack>
  <ModuleTabBar tabs={VOTING_TABS} />
  </View>
  );
}
