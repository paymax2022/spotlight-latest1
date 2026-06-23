// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
const strength = (p: string) => {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[0-9]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
};
const strengthLabel = ['','Weak','Fair','Good','Strong'];
const strengthColor = ['',colors.secondary.red,colors.secondary.amber,colors.secondary.DEFAULT,colors.secondary.emerald];
export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const s = strength(newPw);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Change Password</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        {[{l:'Current Password',v:current,s:setCurrent},{l:'New Password',v:newPw,s:setNewPw},{l:'Confirm New Password',v:confirm,s:setConfirm}].map((f,i)=>(
          <View key={i} style={styles.fieldGroup}><Text style={styles.label}>{f.l}</Text><TextInput style={styles.input} value={f.v} onChangeText={f.s} secureTextEntry placeholderTextColor={colors.neutral.placeholder} placeholder="••••••••"/></View>
        ))}
        {newPw.length > 0 && (
          <View style={styles.strengthWrap}>
            <View style={styles.strengthTrack}><View style={[styles.strengthBar,{width:`${(s/4)*100}%`,backgroundColor:strengthColor[s]}]}/></View>
            <Text style={[styles.strengthLabel,{color:strengthColor[s]}]}>{strengthLabel[s]}</Text>
          </View>
        )}
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Update Password</Text></Pressable>
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
  fieldGroup:{gap:8},
  label:{fontSize:13,fontWeight:'600',color:colors.neutral.textMuted},
  input:{backgroundColor:colors.neutral.surface,borderRadius:12,padding:14,fontSize:15,color:colors.neutral.text,borderWidth:1,borderColor:colors.neutral.border},
  strengthWrap:{gap:6},
  strengthTrack:{height:6,backgroundColor:colors.neutral.surfaceAlt,borderRadius:3},
  strengthBar:{height:6,borderRadius:3},
  strengthLabel:{fontSize:12,fontWeight:'700'},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
