import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Bell } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  name:          string;
  greeting?:     string;
  avatarUri?:    string;
  notifCount?:   number;
}

// Time-of-day greeting based on the device's local hour:
//   05:00–11:59 → Good Morning
//   12:00–16:59 → Good Afternoon
//   17:00–20:59 → Good Evening
//   21:00–04:59 → Good Night
function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  if (h < 21) return 'Good Evening';
  return 'Good Night';
}

export default function AppHeader({ name, greeting, avatarUri, notifCount = 0 }: Props) {
  return (
    <View style={styles.container}>
      {/* Avatar + Greeting */}
      <View style={styles.left}>
        <Pressable onPress={() => router.push('/(tabs)/profile')} style={styles.avatar}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            : <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
          }
        </Pressable>
        <View>
          <Text style={styles.hello}>Hello, {name}</Text>
          <Text style={styles.greeting}>{greeting ?? getGreeting()}</Text>
        </View>
      </View>

      {/* Notification bell */}
      <Pressable onPress={() => router.push('/(tabs)/notifications')} style={styles.bellWrap}>
        <Bell size={22} color={Colors.onSurface} strokeWidth={1.8} />
        {notifCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingTop:      Spacing.md,
    paddingBottom:   Spacing.sm,
    backgroundColor: Colors.background,
  },
  left: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
  },
  avatar: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: Colors.primaryContainer,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  avatarImg: {
    width:  40,
    height: 40,
  },
  avatarInitial: {
    ...Typography.labelLg,
    color: Colors.onPrimary,
  },
  hello: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
  },
  greeting: {
    ...Typography.labelMd,
    color: Colors.onSurface,
  },
  bellWrap: {
    width:           40,
    height:          40,
    alignItems:      'center',
    justifyContent:  'center',
    position:        'relative',
  },
  badge: {
    position:        'absolute',
    top:             6,
    right:           6,
    minWidth:        16,
    height:          16,
    borderRadius:    8,
    backgroundColor: Colors.error,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.onError,
  },
});
