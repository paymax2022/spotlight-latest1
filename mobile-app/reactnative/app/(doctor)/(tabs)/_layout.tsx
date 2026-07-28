import { Tabs } from 'expo-router';
import { View, Platform, StyleSheet } from 'react-native';
import { LayoutDashboard, CalendarDays, MessageSquare, FolderOpen, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

function TabIcon({ icon: Icon, focused }: { icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Icon size={22} color={focused ? Colors.primary : Colors.outline} strokeWidth={focused ? 2.2 : 1.8} />
      {focused && <View style={styles.activeDot} />}
    </View>
  );
}

export default function DoctorTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => <TabIcon icon={LayoutDashboard} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
          tabBarIcon: ({ focused }) => <TabIcon icon={CalendarDays} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ focused }) => <TabIcon icon={MessageSquare} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: 'Records',
          tabBarIcon: ({ focused }) => <TabIcon icon={FolderOpen} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ focused }) => <TabIcon icon={Wallet} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position:        'absolute',
    height:          Platform.OS === 'ios' ? 88 : 68,
    paddingBottom:   Platform.OS === 'ios' ? 24 : 8,
    paddingTop:      8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth:  1,
    borderTopColor:  Colors.surfaceContainerHigh,
    ...Platform.select({
      ios: {
        shadowColor:   Colors.primary,
        shadowOffset:  { width: 0, height: -4 },
        shadowOpacity: 0.06,
        shadowRadius:  12,
      },
      android: { elevation: 12 },
    }),
  },
  label: {
    ...Typography.labelSm,
    marginTop: -2,
  },
  iconWrap: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     2,
  },
  iconWrapActive: {},
  activeDot: {
    width:           4,
    height:          4,
    borderRadius:    Radius.full,
    backgroundColor: Colors.primary,
    marginTop:       3,
  },
});
