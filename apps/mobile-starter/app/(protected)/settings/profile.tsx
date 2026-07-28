// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function ProfileSettings() {
  const router = useRouter();
  const [name, setName] = useState('Adaeze Okonkwo');
  const [email, setEmail] = useState('adaeze@example.com');
  const [phone, setPhone] = useState('+234 812 345 6789');
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Edit Profile</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.avatarWrap}><View style={styles.avatar}><Text style={styles.avatarText}>AO</Text></View><View style={styles.editBadge}><Ionicons name="camera" size={14} color="#fff" /></View></Pressable>
        {[{l:'Full Name',v:name,s:setName},{l:'Email',v:email,s:setEmail,keyboard:'email-address'},{l:'Phone',v:phone,s:setPhone,keyboard:'phone-pad'}].map((f,i)=>(
          <View key={i} style={styles.fieldGroup}><Text style={styles.label}>{f.l}</Text><TextInput style={styles.input} value={f.v} onChangeText={f.s} keyboardType={f.keyboard||'default'} autoCapitalize="none" placeholderTextColor={colors.neutral.placeholder} /></View>
        ))}
        <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Save Changes</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.primary.DEFAULT},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:16,alignItems:'center'},
  avatarWrap:{position:'relative',marginBottom:8},
  avatar:{width:80,height:80,borderRadius:40,backgroundColor:colors.primary.DEFAULT+'20',alignItems:'center',justifyContent:'center'},
  avatarText:{fontSize:28,fontWeight:'800',color:colors.primary.DEFAULT},
  editBadge:{position:'absolute',bottom:0,right:0,width:26,height:26,borderRadius:13,backgroundColor:colors.primary.DEFAULT,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#fff'},
  fieldGroup:{width:'100%',gap:8},
  label:{fontSize:13,fontWeight:'600',color:colors.neutral.textMuted},
  input:{backgroundColor:colors.neutral.surface,borderRadius:12,padding:14,fontSize:15,color:colors.neutral.text,borderWidth:1,borderColor:colors.neutral.border},
  primaryBtn:{backgroundColor:colors.primary.DEFAULT,borderRadius:14,height:52,alignItems:'center',justifyContent:'center',width:'100%'},
  primaryBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
});
