// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
export default function DeleteAccount() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const handleDelete = () => Alert.alert('Delete Account','This action is irreversible. All your data will be permanently deleted.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>router.replace('/(auth)/login' as never)}]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable style={styles.backBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable><Text style={styles.headerTitle}>Delete Account</Text><View style={{ width: 38 }} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.warningCard}>
          <Ionicons name="warning" size={36} color={colors.secondary.red}/>
          <Text style={styles.warningTitle}>This is Irreversible</Text>
          <Text style={styles.warningText}>Deleting your account will permanently remove all your data, including visitor history, payment records, and household information. This cannot be undone.</Text>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Confirm your password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Enter your password" placeholderTextColor={colors.neutral.placeholder}/>
        </View>
        <Pressable style={styles.dangerBtn} onPress={handleDelete}>
          <Ionicons name="trash" size={18} color="#fff"/>
          <Text style={styles.dangerBtnText}>Delete My Account</Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.neutral.background},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,backgroundColor:colors.secondary.red},
  backBtn:{width:38,height:38,borderRadius:19,backgroundColor:'rgba(255,255,255,0.2)',alignItems:'center',justifyContent:'center'},
  headerTitle:{fontSize:17,fontWeight:'700',color:'#fff'},
  content:{padding:20,gap:16},
  warningCard:{backgroundColor:colors.secondary.red+'10',borderRadius:16,padding:24,alignItems:'center',gap:10,borderWidth:1,borderColor:colors.secondary.red+'30'},
  warningTitle:{fontSize:18,fontWeight:'800',color:colors.secondary.red},
  warningText:{fontSize:14,color:colors.neutral.text,textAlign:'center',lineHeight:22},
  fieldGroup:{gap:8},
  label:{fontSize:13,fontWeight:'600',color:colors.neutral.textMuted},
  input:{backgroundColor:colors.neutral.surface,borderRadius:12,padding:14,fontSize:15,color:colors.neutral.text,borderWidth:1,borderColor:colors.neutral.border},
  dangerBtn:{backgroundColor:colors.secondary.red,borderRadius:14,height:52,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  dangerBtnText:{color:'#fff',fontSize:16,fontWeight:'700'},
  cancelBtn:{height:52,borderRadius:14,alignItems:'center',justifyContent:'center'},
  cancelBtnText:{fontSize:16,fontWeight:'700',color:colors.neutral.textMuted},
});
