// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { colors } from '@/theme';
import { votingColors } from '@/theme/voting';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { height: 72, borderTopColor: colors.neutral.border, backgroundColor: colors.neutral.white },
        tabBarActiveTintColor: colors.primary.navy,
        tabBarInactiveTintColor: colors.neutral.placeholder,
        tabBarLabelStyle: { fontSize: 12, paddingBottom: 8 },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            index: 'home-outline',
            wallet: 'wallet-outline',
            pay: 'swap-horizontal-outline',
            invest: 'trending-up-outline',
            more: 'grid-outline',
            vote: 'star-outline',
          };

          if (route.name === 'pay') {
            return (
              <Ionicons
                name="add"
                size={22}
                color={colors.neutral.white}
                style={{ backgroundColor: colors.secondary.emerald, borderRadius: 999, padding: 8, overflow: 'hidden' }}
              />
            );
          }

          if (route.name === 'vote') {
            return (
              <View
                style={{
                  backgroundColor: focused ? votingColors.gold.container : 'transparent',
                  borderRadius: 999,
                  padding: focused ? 8 : 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={focused ? 'star' : 'star-outline'}
                  size={size}
                  color={focused ? votingColors.gold.on : color}
                />
              </View>
            );
          }

          return <Ionicons name={icons[route.name] ?? 'ellipse-outline'} size={size} color={focused ? colors.primary.navy : color} />;
        }
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="pay" options={{ title: 'Pay' }} />
      <Tabs.Screen name="vote" options={{ title: 'Vote' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      {/* Invest is not yet backed by an API — keep the route but hide it from the
          tab bar so it never appears as a dead screen (INVEST-1). */}
      <Tabs.Screen name="invest" options={{ href: null }} />
    </Tabs>
  );
}
