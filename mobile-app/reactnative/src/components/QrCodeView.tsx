import React from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';

interface Props {
  payload: string;
  size?: number;
  fill?: string;
}

export default function QrCodeView({ payload, size = 200, fill = Colors.primary }: Props) {
  return (
    <View style={[styles.frame, { width: size + 24, height: size + 24 }]}>
      <QRCode
        value={payload || ' '}
        size={size}
        color={fill}
        backgroundColor={Colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
});
