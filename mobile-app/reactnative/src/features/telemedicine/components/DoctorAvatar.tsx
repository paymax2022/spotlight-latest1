import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

interface Props {
  initials: string;
  color:    string;
  size?:    number;
  online?:  boolean;
}

export default function DoctorAvatar({ initials, color, size = 56, online }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 3, backgroundColor: color }]}>
        <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials}</Text>
      </View>
      {online && <View style={[styles.online, { width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13 }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar:   { alignItems: 'center', justifyContent: 'center' },
  initials: { ...Typography.titleLg, color: Colors.white, fontWeight: '800' },
  online:   { position: 'absolute', right: 0, bottom: 0, backgroundColor: '#16A34A', borderWidth: 2, borderColor: Colors.white, borderRadius: Radius.full },
});
