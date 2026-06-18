// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function TwoFactor() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const disable2FA = () => Alert.alert('Disable 2FA','This reduces your account security.',[{text:'Cancel',style:'cancel'},{text:'Disable',style:'destructive',onPress:()=>setEnabled(false)}]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Two-Factor Auth</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statusCard,{backgroundColor:enabled?colors.secondary.emerald+'15':colors.secondary.red+'15'}]}>
          <Ionicons name={enabled?'shield-checkmark':'shield'} size={36} color={enabled?colors.secondary.emerald:colors.secondary.red}/>
          <Text style={[styles.statusTitle,{color:enabled?colors.secondary.emerald:colors.secondary.red}]}>{enabled?'2FA Enabled':'2FA Disabled'}</Text>
          <Text style={styles.statusSub}>{enabled?'Your account has enhanced security.':'Enable 2FA for better security.'}</Text>
        </View>
        {enabled && (<>
          <View style={styles.card}>
            <View style={styles.listRow}><Ionicons name="phone-portrait" size={18} color={colors.primary.DEFAULT}/><Text style={[styles.listTitle,{flex:1}]}>Authenticator App</Text><View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Active</Text></View></View>
          </View>
          <Pressable style={styles.recoveryBtn}><Ionicons name="key-outline" size={16} color={colors.secondary.DEFAULT}/><Text style={styles.recoveryBtnText}>View Recovery Codes</Text></Pressable>
          <Pressable style={styles.dangerBtn} onPress={disable2FA}><Text style={styles.dangerBtnText}>Disable 2FA</Text></Pressable>
        </>)}
        {!enabled && <Pressable style={styles.primaryBtn} onPress={()=>setEnabled(true)}><Text style={styles.primaryBtnText}>Enable 2FA</Text></Pressable>}
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
  statusCard:{borderRadius:16,padding:24,alignItems:'center',gap:8},
  statusTitle:{fontSize:18,fontWeight:'800'},
  statusSub:{fontSize:13,color:colors.neutral.textMuted,textAlign:'center'},
  card:{backgroundColor:colors.neutral.surface,borderRadius:16,overflow:'hidden',shadowColor:'#000',shadowOpacity:0.04,elevation:2},
  listRow:{flexDirection:'row',alignItems:'center',gap:12,padding:14},
  listTitle:{fontSize:14,fontWeight:'600',color:colors.neutral.text},
  activeBadge:{backgroundColor:colors.secondary.emerald+'20',paddingHorizontal:10,paddingVertical:3,borderRadius:20},
  activeBadgeText:{fontSize:11,fontWeight:'700',color:colors.secondary.emerald},
  recoveryBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,height:52,borderRadius:14,borderWidth:1.5,borderColor:colors.secondary.DEFAULT},
  recoveryBtnText:{fontSize:15,fontWeight:'700',color:colors.secondary.DEFAULT},
  dangerBtn:{height:52,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.secondary.red+'10',borderWidth:1,borderColor:colors.secondary.red+'40'},
  dangerBtnText:{fontSize:15,fontWeight:'700',color:colors.secondary.red},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
