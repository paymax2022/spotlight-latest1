// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function BiometricSettings() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const disable = () => Alert.alert('Disable Biometric','Are you sure? You will need your password to sign in.',[{text:'Cancel',style:'cancel'},{text:'Disable',style:'destructive',onPress:()=>setEnabled(false)}]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Biometric</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconCard}><Ionicons name="finger-print" size={60} color={enabled?colors.primary.DEFAULT:colors.neutral.placeholder}/><Text style={styles.iconLabel}>{enabled?'Biometric Enabled':'Biometric Disabled'}</Text></View>
        <View style={styles.card}>
          <View style={styles.toggleRow}><View style={{flex:1}}><Text style={styles.listTitle}>Biometric Login</Text><Text style={styles.listSub}>Use fingerprint or face to sign in</Text></View><Switch value={enabled} onValueChange={setEnabled} trackColor={{false:colors.neutral.border,true:colors.primary.DEFAULT}} thumbColor="#fff"/></View>
        </View>
        <View style={styles.card}>
          <View style={styles.listRow}><Ionicons name="phone-portrait" size={18} color={colors.neutral.textMuted}/><Text style={[styles.listTitle,{flex:1}]}>iPhone 14 Pro (Current)</Text><View style={styles.enrolledBadge}><Text style={styles.enrolledText}>Enrolled</Text></View></View>
        </View>
        <Pressable style={styles.reEnrollBtn}><Text style={styles.reEnrollText}>Re-enroll Biometric</Text></Pressable>
        {enabled && <Pressable style={styles.dangerBtn} onPress={disable}><Text style={styles.dangerBtnText}>Disable Biometric</Text></Pressable>}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:16},
  iconCard:{backgroundColor:colors.neutral.surface,borderRadius:16,padding:30,alignItems:'center',gap:10},
  iconLabel:{fontSize:16,fontWeight:'700',color:colors.neutral.text},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  toggleRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  listSub:{fontSize:12,color:colors.neutral.textMuted,marginTop:2},
  enrolledBadge:{backgroundColor:colors.secondary.emerald+'20',paddingHorizontal:10,paddingVertical:3,borderRadius:20},
  enrolledText:{fontSize:11,fontWeight:'700',color:colors.secondary.emerald},
  reEnrollBtn:{height:52,borderRadius:14,alignItems:'center',justifyContent:'center',borderWidth:1.5,borderColor:colors.primary.DEFAULT},
  reEnrollText:{fontSize:15,fontWeight:'700',color:colors.primary.DEFAULT},
  dangerBtn:{height:52,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.secondary.red+'15',borderWidth:1,borderColor:colors.secondary.red+'40'},
  dangerBtnText:{fontSize:15,fontWeight:'700',color:colors.secondary.red},
});
